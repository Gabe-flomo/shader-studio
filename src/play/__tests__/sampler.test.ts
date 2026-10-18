/**
 * Drum pads → Sampler (docs/sampler.md, "Migration"): an old `drumpad` record
 * loads as a Sampler's Drum view with every pad, number and setting; its
 * control targets keep their names; and the kit renders the same through the
 * new engine as through the old one (sample against sample). Then the Keys
 * view in an offline mix: notes at pitch from their zone's root, a take's
 * round robin pick repeated. Real Web Audio in Node, into buffers only.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { OfflineAudioContext as NodeOffline } from 'node-web-audio-api';
import { dpCreateSampler, dpHitNumbers, dpKey, dpSynthData } from '../kit/drumPads.js';
import { defaultLayer, parseLayer, parsePlayRecordAsSaved, type PlayRecord } from '../../types/play';
import { layerNumericProps, newSamplerZone, type DrumPad, type SamplerLayer, type SamplerZone } from '../../types/playLayers';
import { mixBuffers, padHitsOf, padTrackOf } from '../../lib/recordingAudio';
import { takeValueAt } from '../../lib/audioFxOffline';

const RATE = 44100;
beforeAll(() => {
  (globalThis as unknown as { OfflineAudioContext: unknown }).OfflineAudioContext = NodeOffline;
});

/** A Drum pads layer as an old file had it: all 16 pads' ten numbers. */
function oldKit(): Record<string, unknown> {
  const l: Record<string, unknown> = {
    id: 'd', kind: 'drumpad', label: 'Old kit', visible: true, volume: 1, keys: true, midi: true, channel: 3, baseNote: 40, grid: false,
    sampleIndex: 0, indexMode: 'index', indexSpread: 1, indexSeed: 4,
    pads: [
      { synth: 'kick', name: 'Boom', mode: 'oneshot' },
      { synth: 'openhat', mode: 'gate', loop: true, choke: 1 },
      { synth: 'snare', reverse: true },
      { synth: 'hat', choke: 1 },
    ],
  };
  const defaults: Record<string, number> = { start: 0, end: 1, pitch: 0, volume: 0.8, pan: 0, attack: 0.001, decay: 0.2, sustain: 1, release: 0.05, vel: 1 };
  for (let i = 0; i < 16; i++) for (const [k, v] of Object.entries(defaults)) l[`pad${i + 1}_${k}`] = v;
  Object.assign(l, {
    pad1_pitch: -3, pad1_decay: 0.3, pad1_sustain: 0.4,
    pad2_start: 0.05, pad2_end: 0.5, pad2_release: 0.2, pad2_attack: 0.01, pad2_decay: 0.05, pad2_sustain: 0.6,
    pad3_volume: 1.1, pad3_pan: 0.4, pad3_vel: 0.5, pad3_start: 0.2,
    pad4_pitch: 5, pad4_volume: 0.5,
  });
  return l;
}

describe('Drum pads → Sampler', () => {
  it('an old record loads as the Drum view with every pad, number and setting', () => {
    const l = parseLayer(oldKit()) as SamplerLayer;
    expect(l.kind).toBe('sampler');
    expect(l.view).toBe('drum');
    expect(l).toMatchObject({ label: 'Old kit', volume: 1, keys: true, midi: true, channel: 3, baseNote: 40, grid: false, indexSeed: 4 });
    // Its window sits on its base note, so the same 16 pads are in view.
    expect(l.bank).toBe(40);
    expect(l.pads[0]).toMatchObject({ synth: 'kick', name: 'Boom', mode: 'oneshot' });
    expect(l.pads[1]).toMatchObject({ synth: 'openhat', mode: 'gate', loop: true, choke: 1 });
    expect(l.pads[2].reverse).toBe(true);
    expect([l.pad1_pitch, l.pad1_decay, l.pad2_release, l.pad3_pan, l.pad4_pitch]).toEqual([-3, 0.3, 0.2, 0.4, 5]);
    // The new numbers start where the old engine was.
    expect([l.pad1_aSlope, l.pad1_fEnv, l.pad1_pEnv, l.pad1_lfoAmt, l.pad1_fadeOut, l.pad1_loopStart, l.pad1_loopEnd]).toEqual([0, 0, 0, 0, 0.003, 0, 1]);
    expect(l.pads[0].filter).toBeUndefined();
  });

  it('controls, mappings, takes and actions on the old names keep working', () => {
    const rec = parsePlayRecordAsSaved({
      version: 1,
      controls: [{ id: 'c1', label: 'Kick pitch', target: 'layer:d::pad1_pitch', min: -12, max: 12, value: -3 }],
      mappings: [],
      layers: [oldKit()],
      actions: [{ id: 'a', trigger: { on: 'key', code: 'Space' }, do: 'pad', layerId: 'd', amount: 2, enabled: true }],
      takes: [{ id: 't', name: 'T', from: 0, length: 2, tracks: [], events: [{ t: 0.5, do: 'pad', layerId: 'd', amount: 1, vel: 0.9 }] }],
    }) as PlayRecord;
    const l = rec.layers[0] as SamplerLayer;
    expect(l.kind).toBe('sampler');
    expect(rec.controls[0].target).toBe('layer:d::pad1_pitch');
    // The target is still a number of the layer, under the same key.
    expect(layerNumericProps(l).some(p => p.key === 'pad1_pitch')).toBe(true);
    expect(layerNumericProps(l).some(p => p.key === 'pad4_volume')).toBe(true);
    expect(rec.actions?.[0]).toMatchObject({ do: 'pad', layerId: 'd', amount: 2 });
    expect(padHitsOf(rec.takes![0], 0)).toEqual([{ layerId: 'd', pad: 0, vel: 0.9, t: 0.5 }]);
  });

  it('a migrated kit renders the same as the old drum pads did', async () => {
    const old = oldKit();
    const hits = [
      { pad: 0, t: 0.02, vel: 0.9 }, { pad: 2, t: 0.15, vel: 0.5 }, { pad: 1, t: 0.3, vel: 1 },
      { pad: 1, t: 0.7, vel: 0 }, { pad: 3, t: 0.9, vel: 0.7 }, { pad: 0, t: 1.0, vel: 0.4 },
    ];
    const kinds = ['kick', 'openhat', 'snare', 'hat'];
    // The old engine, as the old offline mix drove it.
    const octx = new NodeOffline(2, Math.ceil(1.5 * RATE), RATE) as unknown as OfflineAudioContext;
    const bufs = kinds.map(k => { const d = dpSynthData(k, RATE); const b = octx.createBuffer(1, d.length, RATE); b.getChannelData(0).set(d); return b; });
    const s = dpCreateSampler(octx);
    s.output.connect(octx.destination);
    for (const h of hits) {
      const p = (old.pads as Array<Record<string, unknown>>)[h.pad];
      if (h.vel <= 0) { s.release(h.pad, h.t); continue; }
      s.hit(h.pad, { ...dpHitNumbers(k => old[dpKey(h.pad, k)] as number), buffer: bufs[h.pad], mode: (p.mode as 'gate') ?? 'oneshot', loop: !!p.loop, reverse: !!p.reverse, choke: (p.choke as number) ?? 0, velocity: h.vel }, h.t);
    }
    const before = await octx.startRendering();
    // The new: the parsed layer through the offline mix (the Sampler's engine and smHits).
    const l = parseLayer(old) as SamplerLayer;
    const byPad = new Map<DrumPad | SamplerZone, AudioBuffer>(l.pads.slice(0, 4).map((p, i) => [p, bufs[i]]));
    const track = padTrackOf(l, p => byPad.get(p) ?? null)!;
    const take = { from: 0, events: hits.map(h => ({ t: h.t, do: 'pad', layerId: 'd', amount: h.pad + 1, vel: h.vel })) };
    const after = (await mixBuffers([track], [], 1.5, 0, RATE, { fx: undefined, padHits: padHitsOf(take, 0), valueAt: takeValueAt(take as never, 0) }))!;
    let err = 0, peak = 0;
    for (let c = 0; c < 2; c++) {
      const a = before.getChannelData(c), b = after.getChannelData(c);
      for (let i = 0; i < a.length; i++) { err = Math.max(err, Math.abs(a[i] - b[i])); peak = Math.max(peak, Math.abs(a[i])); }
    }
    expect(peak).toBeGreaterThan(0.3);
    expect(err).toBeLessThan(2e-3);
  });
});

describe('the Keys view in an offline mix', () => {
  const sine = (hz: number, secs: number) => (ctx: BaseAudioContext) => {
    const b = ctx.createBuffer(1, Math.ceil(secs * RATE), RATE);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = 0.5 * Math.sin(2 * Math.PI * hz * i / RATE);
    return b;
  };
  const crossings = (d: Float32Array, a: number, b: number) => { let n = 0; for (let i = a + 1; i < b; i++) if ((d[i - 1] < 0) !== (d[i] < 0)) n++; return n; };

  it('a note plays its zone at pitch from the root key, on its sample', async () => {
    const ctx = new NodeOffline(1, 10, RATE) as unknown as OfflineAudioContext;
    const z = newSamplerZone(1, { synth: 'tom', root: 60 });
    const l: SamplerLayer = { ...(defaultLayer('sampler', 'k', 'Keys') as SamplerLayer), view: 'keys', baseNote: 0, zones: [z] };
    l.k_attack = 0.001;
    const buf = sine(441, 2)(ctx);
    const track = padTrackOf(l, () => buf)!;
    // C4 (72): an octave up, so 441 Hz plays at 882.
    const take = { from: 0, events: [{ t: 0.25, do: 'pad', layerId: 'k', amount: 73, vel: 1 }] };
    const out = (await mixBuffers([track], [], 1, 0, RATE, { fx: undefined, padHits: padHitsOf(take, 0) }))!.getChannelData(0);
    const first = out.findIndex(v => Math.abs(v) > 1e-4);
    expect(Math.abs(first - Math.round(0.25 * RATE))).toBeLessThanOrEqual(1);
    const n = crossings(out, Math.round(0.4 * RATE), Math.round(0.5 * RATE));
    expect(n).toBeGreaterThanOrEqual(175);
    expect(n).toBeLessThanOrEqual(178);
  });

  it('a take’s round robin pick plays the same zone in a render', async () => {
    const ctx = new NodeOffline(1, 10, RATE) as unknown as OfflineAudioContext;
    const low = sine(220, 1)(ctx), high = sine(880, 1)(ctx);
    const z1 = newSamplerZone(1, { synth: 'tom', root: 60 }), z2 = newSamplerZone(2, { synth: 'rim', root: 60 });
    const l: SamplerLayer = { ...(defaultLayer('sampler', 'k', 'Keys') as SamplerLayer), view: 'keys', baseNote: 0, zones: [z1, z2], inst: { ...(defaultLayer('sampler', 'k', 'Keys') as SamplerLayer).inst, select: 'cycle' } };
    const track = padTrackOf(l, s => ((s as SamplerZone).id === 1 ? low : high))!;
    // The take says zone 2 played (it was the second hit live), so the render plays zone 2 though it starts fresh.
    const take = { from: 0, events: [{ t: 0.1, do: 'pad', layerId: 'k', amount: 61, vel: 1, slot: 2 }] };
    const out = (await mixBuffers([track], [], 0.6, 0, RATE, { fx: undefined, padHits: padHitsOf(take, 0) }))!.getChannelData(0);
    const n = crossings(out, Math.round(0.2 * RATE), Math.round(0.3 * RATE));
    expect(n).toBeGreaterThanOrEqual(174);
    expect(n).toBeLessThanOrEqual(178);
  });
});
