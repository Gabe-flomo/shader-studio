/**
 * Drum kits (docs/drum-pads.md, "Kits"): a layer saved as a kit and loaded
 * back (round trip), Replace against Merge into empty pads, samples this
 * device lacks, the built-in kits, the Files page listing, and a kit leaving
 * as a .playfile with the samples it uses (and the importer taking sounds).
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = globalThis;
  g.dispatchEvent = () => true;
  g.addEventListener = () => undefined;
  g.removeEventListener = () => undefined;
});

import {
  applyDrumKit, BUILTIN_KITS, defaultPadNumbers, deleteDrumKit, DRUM_KITS_KEY, installDrumKits, kitFromLayer, kitMissing, kitSampleIds, kitSummary, loadDrumKits, parseDrumKit, renameDrumKit, saveDrumKit, type ListKV,
} from '../drumKits';
import { defaultLayer } from '../../types/play';
import { emptyDrumPad, type DrumPadLayer } from '../../types/playLayers';
import { layerChainId, type PlayAudioFx } from '../../types/playAudioFx';
import { afNewEffect } from '../kit/audioFx.js';
import { DP_PADS, dpKey } from '../kit/drumPads.js';
import { buildInventory } from '../../files/inventory';
import { memoryKV } from '../../files/mutate';
import { buildBundle, videoIdsIn } from '../../playfile/bundle';
import { planImport, type ImportEnv } from '../../playfile/importer';
import type { PlayfileContents } from '../../playfile/reader';
import { utf8 } from '../../playfile/bytes';

function mapKV(): ListKV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: k => data.get(k) ?? null, set: (k, v) => { data.set(k, v); } };
}

function layer(): { l: DrumPadLayer; fx: PlayAudioFx } {
  const l = defaultLayer('drumpad', 'L1', 'Beat') as DrumPadLayer;
  l.pads[0] = { ...emptyDrumPad(), sampleId: 'snd_kick', fileName: 'kick.wav', bytes: 4000, name: 'Big kick', mode: 'oneshot', loop: false, reverse: false, choke: 1 };
  l.pads[1] = { ...emptyDrumPad(), synth: 'snare', mode: 'gate', loop: true, reverse: true, choke: 0 };
  l.pads[2] = { ...emptyDrumPad(), sampleId: 'snd_hat', fileName: 'hat.wav', bytes: 900 };
  l[dpKey(0, 'pitch') as `pad${number}_${string}`] = -5;
  l[dpKey(0, 'start') as `pad${number}_${string}`] = 0.1;
  l[dpKey(1, 'release') as `pad${number}_${string}`] = 0.4;
  l[dpKey(2, 'volume') as `pad${number}_${string}`] = 1.2;
  l.volume = 0.7; l.keys = false; l.midi = true; l.channel = 3; l.baseNote = 48; l.grid = false;
  const fx: PlayAudioFx = { chains: { [layerChainId('L1')]: { on: true, effects: [afNewEffect('filter', 'fx1'), afNewEffect('reverb', 'fx2')] } } };
  return { l, fx };
}

describe('drum kits: save and load', () => {
  it('round-trips every pad, the numbers, the settings and the effect chain', () => {
    const kv = mapKV();
    const { l, fx } = layer();
    const { result, kit } = saveDrumKit('Mine', l, fx, kv);
    expect(result.ok).toBe(true);
    expect(kit!.name).toBe('Mine');
    expect(kit!.numbers).toEqual({ pad1_pitch: -5, pad1_start: 0.1, pad2_release: 0.4, pad3_volume: 1.2 });
    expect(kit!.fx?.effects.map(e => e.kind)).toEqual(['filter', 'reverb']);
    const [loaded] = loadDrumKits(kv);
    expect(loaded).toEqual(kit);
    // Onto a fresh layer with another id: the same pads, numbers, settings, and a chain on that layer.
    const fresh = defaultLayer('drumpad', 'L2', 'New') as DrumPadLayer;
    const r = applyDrumKit(fresh, undefined, loaded, 'replace');
    expect(r.layer.pads).toEqual(l.pads);
    for (let i = 0; i < DP_PADS; i++) for (const k of Object.keys(defaultPadNumbers()).filter(k => k.startsWith(`pad${i + 1}_`))) expect(r.layer[k as `pad${number}_${string}`]).toBe(l[k as `pad${number}_${string}`]);
    expect([r.layer.volume, r.layer.keys, r.layer.midi, r.layer.channel, r.layer.baseNote, r.layer.grid]).toEqual([0.7, false, true, 3, 48, false]);
    const chain = r.fx?.chains[layerChainId('L2')];
    expect(chain?.effects.map(e => e.kind)).toEqual(['filter', 'reverb']);
    // Loaded effects get new ids, so they never collide with the layer's controls.
    expect(chain?.effects.map(e => e.id)).not.toEqual(['fx1', 'fx2']);
    expect(r.filled).toBe(3);
  });

  it('saving under a taken name replaces that kit (keeping its id); rename and delete work', () => {
    const kv = mapKV();
    const { l, fx } = layer();
    const a = saveDrumKit('Mine', l, fx, kv).kit!;
    const b = saveDrumKit('Mine', { ...l, volume: 0.2 }, undefined, kv).kit!;
    expect(loadDrumKits(kv)).toHaveLength(1);
    expect(b.id).toBe(a.id);
    expect(loadDrumKits(kv)[0].volume).toBe(0.2);
    expect(loadDrumKits(kv)[0].fx).toBeUndefined();
    expect(renameDrumKit(a.id, '  Better  ', kv).ok).toBe(true);
    expect(loadDrumKits(kv)[0].name).toBe('Better');
    expect(renameDrumKit(a.id, '   ', kv).ok).toBe(false);
    expect(saveDrumKit('', l, fx, kv).result.ok).toBe(false);
    expect(deleteDrumKit(a.id, kv).ok).toBe(true);
    expect(loadDrumKits(kv)).toEqual([]);
  });

  it('parses stored kits leniently and drops junk', () => {
    expect(parseDrumKit(null)).toBeNull();
    expect(parseDrumKit({ id: 'k', pads: 'no' })).toBeNull();
    const k = parseDrumKit({ id: 'k', name: '', pads: [{ synth: 'kick', choke: 99 }, { synth: 'nope' }], numbers: { pad1_pitch: 100, pad99_pitch: 1, pad1_bogus: 1, pad2_pan: 'x' }, volume: 9, channel: 40, fx: { on: true, effects: [{ kind: 'reverb', id: 'r' }, { kind: 'bogus' }] } })!;
    expect(k.name).toBe('Drum kit');
    expect(k.pads).toHaveLength(DP_PADS);
    expect(k.pads[0].synth).toBe('kick');
    expect(k.pads[0].choke).toBe(8);
    expect(k.pads[1].synth).toBe('');
    expect(k.numbers).toEqual({ pad1_pitch: 24 });
    expect(k.volume).toBe(2);
    expect(k.channel).toBe(16);
    expect(k.fx?.effects.map(e => e.kind)).toEqual(['reverb']);
    // Stored JSON that isn't a list gives no kits, not an error.
    const kv = mapKV(); kv.set(DRUM_KITS_KEY, '{"oops":1}');
    expect(loadDrumKits(kv)).toEqual([]);
  });
});

describe('drum kits: merge against replace', () => {
  it('merge fills only the empty pads and leaves settings and effects alone', () => {
    const { l, fx } = layer();
    const kit = kitFromLayer(l, fx, 'Kit');
    const target = defaultLayer('drumpad', 'T', 'Target') as DrumPadLayer;
    target.pads[0] = { ...emptyDrumPad(), synth: 'cowbell' };
    target[dpKey(0, 'pitch') as `pad${number}_${string}`] = 7;
    target.volume = 0.3; target.keys = true;
    const theirFx: PlayAudioFx = { chains: { [layerChainId('T')]: { on: true, effects: [afNewEffect('echo', 'e1')] } } };
    const r = applyDrumKit(target, theirFx, kit, 'merge');
    // Pad 1 was taken: it keeps the cowbell and its pitch.
    expect(r.layer.pads[0].synth).toBe('cowbell');
    expect(r.layer.pad1_pitch).toBe(7);
    // Pads 2 and 3 were empty: the kit's snare and hat land there with their numbers.
    expect(r.layer.pads[1].synth).toBe('snare');
    expect(r.layer.pad2_release).toBe(0.4);
    expect(r.layer.pads[2].sampleId).toBe('snd_hat');
    expect(r.layer.pad3_volume).toBe(1.2);
    expect(r.filled).toBe(2);
    // Settings and the chain are the layer's own still.
    expect([r.layer.volume, r.layer.keys]).toEqual([0.3, true]);
    expect(r.fx).toBe(theirFx);
  });

  it('replace puts the kit\'s numbers everywhere (defaults where the kit had none) and drops a chain the kit lacks', () => {
    const { l } = layer();
    const kit = kitFromLayer(l, undefined, 'Dry');
    const target = defaultLayer('drumpad', 'T', 'Target') as DrumPadLayer;
    target[dpKey(5, 'pitch') as `pad${number}_${string}`] = 9;
    const had: PlayAudioFx = { chains: { [layerChainId('T')]: { on: true, effects: [afNewEffect('echo', 'e1')] }, master: { on: true, effects: [afNewEffect('reverb', 'm1')] } } };
    const r = applyDrumKit(target, had, kit, 'replace');
    expect(r.layer.pad6_pitch).toBe(0);
    expect(r.layer.pad1_pitch).toBe(-5);
    expect(r.fx?.chains[layerChainId('T')]).toBeUndefined();
    expect(r.fx?.chains.master?.effects).toHaveLength(1);
  });
});

describe('drum kits: samples and built-ins', () => {
  it('names the samples a kit uses and which this device lacks', () => {
    const { l, fx } = layer();
    const kit = kitFromLayer(l, fx, 'Kit');
    expect(kitSampleIds(kit).sort()).toEqual(['snd_hat', 'snd_kick']);
    expect(kitMissing(kit, id => id === 'snd_kick')).toEqual(['hat.wav']);
    expect(kitMissing(kit, () => true)).toEqual([]);
    expect(kitSummary(kit, k => k.toUpperCase())).toBe('3 pads · 2 samples · FILTER → REVERB');
  });

  it('ships three built-in kits made from generated drums only', () => {
    expect(BUILTIN_KITS.map(k => k.name)).toEqual(['808-ish', 'Acoustic-ish', 'Percussion']);
    for (const k of BUILTIN_KITS) {
      expect(k.id.startsWith('builtin:')).toBe(true);
      expect(kitSampleIds(k)).toEqual([]);
      expect(k.pads.filter(p => p.synth).length).toBe(DP_PADS);
      const r = applyDrumKit(defaultLayer('drumpad', 'X', 'X') as DrumPadLayer, undefined, k, 'replace');
      expect(r.filled).toBe(DP_PADS);
    }
    expect(BUILTIN_KITS[1].fx?.effects[0].kind).toBe('reverb');
  });
});

describe('drum kits: the Files page and .playfile', () => {
  it('lists kits under Presets → Drum kits and bundles one with the samples it names', async () => {
    const { l, fx } = layer();
    const kit = kitFromLayer(l, fx, 'Mine', 'kit_1');
    const kv = memoryKV({ [DRUM_KITS_KEY]: JSON.stringify([kit, BUILTIN_KITS[0]]) });
    const inv = await buildInventory(kv);
    const groupNode = inv.byId.get('section:presets/drum-kits');
    expect(groupNode?.label).toBe('Drum kits');
    const node = inv.byId.get('dkit:kit_1');
    expect(node?.detail).toBe('3 pads · 2 samples · 2 effects');
    // Kits never look like graphs.
    expect(inv.sections.find(s => s.section === 'graphs')?.children).toEqual([]);
    const bundle = await buildBundle(kv, inv, ['dkit:kit_1'], { dependencies: false });
    expect(bundle.items.map(i => i.kind)).toEqual(['library']);
    const snap = JSON.parse(bundle.items[0].data as string) as { items: Record<string, string> };
    const list = JSON.parse(snap.items[DRUM_KITS_KEY]) as Array<{ id: string }>;
    expect(list.map(k => k.id)).toEqual(['kit_1']);
    expect(videoIdsIn(bundle.items).sort()).toEqual(['snd_hat', 'snd_kick']);
    // Installing the library item's kits keeps them by id.
    const back = mapKV();
    expect(installDrumKits(list.map(parseDrumKit).filter((k): k is NonNullable<typeof k> => !!k), back).ok).toBe(true);
    expect(loadDrumKits(back)[0].name).toBe('Mine');
  });

  it('the importer takes a sound (audio) file back as a video item', async () => {
    const kv = memoryKV();
    const env: ImportEnv = { kv, can: () => true, userNode: () => undefined, registerNode: async () => ({ ok: true }), makeNodeId: l => l, hasVideo: async id => id === 'have' };
    const item = (path: string, type: string, id: string) => ({ kind: 'video' as const, path, name: path.split('/').pop()!, bytes: 3, sha256: '', meta: { id, type }, data: utf8('abc') });
    const contents = {
      manifest: { format: 'playfile', version: 1, kinds: ['video'], items: [] }, items: [item('videos/kick.wav', 'audio/wav', 'snd_kick'), item('videos/hat.flac', '', 'snd_hat'), item('videos/clip.mp4', 'video/mp4', 'have'), item('videos/x.txt', '', 'x')],
      signature: { state: 'none' as const },
    } as unknown as PlayfileContents;
    const plan = await planImport(contents, env);
    expect(plan.rows.map(r => [r.name, r.status, r.detail])).toEqual([
      ['kick.wav', 'new', 'Sound · WAV'], ['hat.flac', 'new', 'Sound · FLAC'], ['clip.mp4', 'same', 'MP4'], ['x.txt', 'unreadable', undefined],
    ]);
    expect((plan.rows[1].value as { type: string }).type).toBe('audio/flac');
  });
});
