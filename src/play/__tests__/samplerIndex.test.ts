/**
 * The Sample player's Sample index (docs/audio-engine.md, "Sample index"):
 * the pure pick (play/kit/samplerIndex.js), the settings on the record
 * (targets, parsing, macros), and the host's note rewrite where notes enter
 * a rack (with a fake Tauri bridge: nothing is heard).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
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
});

import { SI_PARAMS, siClamp, siHold, siLetGo, siMode, siOrder, siPick, siPickNote, siZoneOf } from '../kit/samplerIndex.js';
import { dpHash01 } from '../kit/drumPads.js';
import {
  AE_INST, auTarget, auTargetExists, macroCanTarget, newRack, parseAudioEngine, readAuValue, slotSetting, zonesFor, type AeRack, type AeZone, type PlayAudioEngine,
} from '../../types/playAudioEngine';
import { audioEngineHost, RACK_ACT_PREFIX } from '../../lib/audioEngineHost';
import { usePlan } from '../../lib/plan';
import { jobParams } from '../../lib/engineRender';

const kit = (n: number, from = 36): AeZone[] => zonesFor(Array.from({ length: n }, (_, i) => ({ id: `snd_${i}`, name: `S${i}` })), 'keys', from);
/** Two pitched zones side by side: 36..59 rooted on 48, 60..83 rooted on 72. */
const pitched: AeZone[] = [
  { sampleId: 'snd_hi', name: 'Hi', lo: 60, hi: 83, root: 72, gain: 1 },
  { sampleId: 'snd_lo', name: 'Lo', lo: 36, hi: 59, root: 48, gain: 1 },
];

describe('the pick (samplerIndex.js)', () => {
  it('orders zones by their lowest key and finds the zone a note lands in', () => {
    expect(siOrder(pitched)).toEqual([1, 0]);
    expect(siZoneOf(pitched, 40)).toBe(1);
    expect(siZoneOf(pitched, 83)).toBe(0);
    expect(siZoneOf(pitched, 20)).toBe(-1);
  });

  it('steps Index zones on, wrapping round', () => {
    const z = kit(4); // 36..39
    expect(siPickNote(z, 36, 0, 'index', 0, 0)).toBe(36);
    expect(siPickNote(z, 36, 1, 'index', 0, 0)).toBe(37);
    expect(siPickNote(z, 38, 3, 'index', 0, 0)).toBe(37);
    expect(siPickNote(z, 36, -1, 'index', 0, 0)).toBe(39);
    expect(siPickNote(z, 36, 9, 'index', 0, 0)).toBe(37);
    // The same key walks through every sound as Index rises.
    expect([0, 1, 2, 3, 4].map(i => siPickNote(z, 37, i, 'index', 0, 0))).toEqual([37, 38, 39, 36, 37]);
    // A note in no zone is itself.
    expect(siPickNote(z, 60, 2, 'index', 0, 0)).toBe(60);
  });

  it('keeps the note’s distance from its zone’s root', () => {
    // 43 is 5 below Lo's root 48: in Hi it is 5 below 72.
    expect(siPickNote(pitched, 43, 1, 'index', 0, 0)).toBe(67);
    expect(siPickNote(pitched, 75, 1, 'index', 0, 0)).toBe(51);
    // Past the new zone's keys: its nearest key.
    const narrow: AeZone[] = [{ sampleId: 'a', name: 'A', lo: 36, hi: 59, root: 48, gain: 1 }, { sampleId: 'b', name: 'B', lo: 60, hi: 62, root: 60, gain: 1 }];
    expect(siPickNote(narrow, 58, 1, 'index', 0, 0)).toBe(62);
    expect(siPickNote(narrow, 40, 1, 'index', 0, 0)).toBe(60);
  });

  it('picks a key the new zone wins where zones overlap', () => {
    // B (60..72) is covered by C on 66..72 (C comes later, so it wins there).
    const z: AeZone[] = [
      { sampleId: 'a', name: 'A', lo: 40, hi: 50, root: 40, gain: 1 },
      { sampleId: 'b', name: 'B', lo: 60, hi: 72, root: 60, gain: 1 },
      { sampleId: 'c', name: 'C', lo: 66, hi: 72, root: 66, gain: 1 },
    ];
    expect(siPickNote(z, 43, 1, 'index', 0, 0)).toBe(63); // 3 above A's root → 3 above B's
    // 8 above → 68, which C plays: B's nearest own key instead.
    expect(siPickNote(z, 48, 1, 'index', 0, 0)).toBe(65);
    expect(siZoneOf(z, 65)).toBe(1);
  });

  it('random and spread are seeded, and stay among the zones', () => {
    const z = kit(8);
    const keys = new Set(z.map(x => x.lo));
    for (let hit = 1; hit <= 200; hit++) {
      const r = siPick(z, 36, 0, 'random', 0, 7, hit);
      expect(keys.has(r)).toBe(true);
      expect(siPick(z, 36, 0, 'random', 0, 7, hit)).toBe(r);
      const s = siPick(z, 40, 2, 'spread', 1, 7, hit);
      // 40 is zone 4; +2 → 6; ±1 → 5..7 → keys 41..43.
      expect(s).toBeGreaterThanOrEqual(41);
      expect(s).toBeLessThanOrEqual(43);
    }
    const seq = (seed: number) => Array.from({ length: 16 }, (_, i) => siPick(z, 36, 0, 'random', 0, seed, i + 1));
    expect(seq(3)).toEqual(seq(3));
    expect(seq(3)).not.toEqual(seq(4));
    expect(new Set(seq(3)).size).toBeGreaterThan(2);
    // The same maths as the drum pads' (shared hash).
    expect(siPickNote(z, 36, 0, 'random', 0, dpHash01(3, 5))).toBe(siPick(z, 36, 0, 'random', 0, 3, 5));
  });

  it('remembers the note sent for each note held, so note-offs match', () => {
    const m = new Map<number, number[]>();
    siHold(m, 60, 62);
    siHold(m, 60, 64); // pressed again before it was let go
    siHold(m, 61, 61);
    expect(siLetGo(m, 60)).toBe(62);
    expect(siLetGo(m, 60)).toBe(64);
    expect(siLetGo(m, 60)).toBeUndefined();
    expect(siLetGo(m, 61)).toBe(61);
    expect(m.size).toBe(0);
  });

  it('keeps settings in range; Index may pass the slider (it wraps)', () => {
    expect(SI_PARAMS.map(p => p.addr)).toEqual([0, 1, 2, 3]);
    expect(siClamp('sampleIndex', 500)).toBe(500);
    expect(siClamp('sampleIndex', 5000)).toBe(1000);
    expect(siClamp('indexMode', 9)).toBe(2);
    expect(siClamp('indexSpread', -3)).toBe(0);
    expect(siMode(1)).toBe('random');
    expect(siMode(7)).toBe('spread');
  });
});

// ── The record ──────────────────────────────────────────────────────────────

const samplerRack = (over: Partial<AeRack> = {}): AeRack => ({ ...newRack('rk_s', []), instrument: { id: AE_INST, kind: 'sampler', zones: kit(4) }, effects: [], ...over });

describe('the settings on the record', () => {
  it('are targets, macro targets and rack controls on the sample player', () => {
    const ae: PlayAudioEngine = { racks: [samplerRack({ instrument: { id: AE_INST, kind: 'sampler', zones: kit(4), params: { 0: 2 } } })] };
    expect(auTargetExists(ae, auTarget('rk_s', AE_INST, '0'))).toBe(true);
    expect(auTargetExists(ae, auTarget('rk_s', AE_INST, '3'))).toBe(true);
    expect(auTargetExists(ae, auTarget('rk_s', AE_INST, '4'))).toBe(false);
    expect(readAuValue(ae, auTarget('rk_s', AE_INST, '0'))).toBe(2);
    expect(readAuValue(ae, auTarget('rk_s', AE_INST, '2'))).toBe(1);
    expect(macroCanTarget(ae.racks[0].instrument!, '1')).toBe(true);
    expect(macroCanTarget(ae.racks[0].instrument!, '9')).toBe(false);
    expect(slotSetting(ae.racks[0].instrument!, '0')?.key).toBe('sampleIndex');
  });

  it('parse: settings kept (in range), unknown ones and controls dropped', () => {
    const raw = { racks: [{ ...samplerRack(), instrument: { id: AE_INST, kind: 'sampler', zones: kit(2), params: { 0: 3, 1: 9, 2: 2, 7: 1 }, controls: ['0', '1', '8'] } }] };
    const inst = parseAudioEngine(JSON.parse(JSON.stringify(raw)))!.racks[0].instrument!;
    expect(inst.params).toEqual({ 0: 3, 1: 2, 2: 2 });
    expect(inst.controls).toEqual(['0', '1']);
    expect(inst.zones).toHaveLength(2);
  });

  it('a render sends no Sample index automation to the engine (the take’s notes already carry it)', () => {
    const take = { from: 0, tracks: [{ kind: 'control', target: auTarget('rk_s', AE_INST, '0'), keys: [{ t: 0, v: 2 }] }] } as never;
    expect(jobParams([samplerRack()], take, 0, 1)).toEqual([]);
  });
});

// ── The host: where notes enter a rack ──────────────────────────────────────

describe('the host rewrites a sample player’s notes', () => {
  const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
  const acts: Array<{ layerId: string; amount: number; vel: number }> = [];
  const taps: number[][] = [];
  const sent = () => calls.filter(c => c.cmd === 'ae_midi').map(c => c.args.bytes as number[]);
  let offTap: () => void = () => {};
  beforeEach(async () => {
    audioEngineHost.resetForTests();
    calls.length = 0; acts.length = 0; taps.length = 0;
    offTap();
    offTap = audioEngineHost.onInput((_r, b) => taps.push(b));
    const invoke = vi.fn(async (cmd: string, args?: unknown) => {
      calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
      if (cmd === 'ae_status') return { available: true, sampleRate: 48000 };
      if (cmd === 'ae_sound_has') return true;
      return null;
    });
    audioEngineHost.configure({
      invoke: invoke as never, listen: (async () => () => {}) as never,
      sounds: async id => ({ blob: new Blob([new Uint8Array([1])]), type: 'audio/wav', name: `${id}.wav` }),
      act: a => { acts.push(a); audioEngineHost.onPad(a); },
    });
    usePlan.getState().setSession({ status: 'signed-in', user: '', plan: 'pro', source: 'open' });
  });

  const start = async (params: Record<string, number>, valueOf?: (id: string, key: string, base: number) => number) => {
    const ae: PlayAudioEngine = { racks: [samplerRack({ instrument: { id: AE_INST, kind: 'sampler', zones: kit(4), params } })] };
    audioEngineHost.frame(ae, [], valueOf);
    await audioEngineHost.settled();
    calls.length = 0;
  };

  it('sends (and the take records) the picked zone’s note; its note-off matches', async () => {
    await start({ 0: 1 });
    audioEngineHost.input('rk_s', [0x90, 36, 100]);
    audioEngineHost.input('rk_s', [0x80, 36, 0]);
    audioEngineHost.input('rk_s', [0x90, 39, 100]);
    audioEngineHost.input('rk_s', [0x90, 39, 0]); // a note-on at velocity 0 lets go too
    expect(sent()).toEqual([[0x90, 37, 100], [0x80, 37, 0], [0x90, 36, 100], [0x80, 36, 0]]);
    expect(acts.map(a => [a.layerId, a.amount, a.vel > 0])).toEqual([
      [`${RACK_ACT_PREFIX}rk_s`, 38, true], [`${RACK_ACT_PREFIX}rk_s`, 38, false], [`${RACK_ACT_PREFIX}rk_s`, 37, true], [`${RACK_ACT_PREFIX}rk_s`, 37, false],
    ]);
    // The tape hears what was sent.
    expect(taps.map(b => b[1])).toEqual([37, 37, 36, 36]);
  });

  it('lets a note go where it was sent even when Index changed while it was held', async () => {
    let index = 1;
    const valueOf = (id: string, key: string, base: number) => (id === 'au:rk_s:inst' && key === '0' ? index : base);
    await start({}, valueOf);
    audioEngineHost.input('rk_s', [0x90, 36, 100]);
    index = 2;
    audioEngineHost.frame({ racks: [samplerRack()] }, [], valueOf);
    audioEngineHost.input('rk_s', [0x90, 36, 90]);
    audioEngineHost.input('rk_s', [0x80, 36, 0]);
    audioEngineHost.input('rk_s', [0x80, 36, 0]);
    expect(sent().map(b => [b[0] & 0xf0, b[1]])).toEqual([[0x90, 37], [0x90, 38], [0x80, 37], [0x80, 38]]);
  });

  it('reads a driven Index (a mapping, an Increment) at each note', async () => {
    const valueOf = (id: string, key: string, base: number) => (id === 'au:rk_s:inst' && key === '0' ? 3 : base);
    await start({ 0: 1 }, valueOf);
    audioEngineHost.input('rk_s', [0x90, 36, 100]);
    expect(sent()[0]).toEqual([0x90, 39, 100]);
  });

  it('plays the tape’s notes as recorded, and takes’ notes as recorded', async () => {
    await start({ 0: 1 });
    audioEngineHost.input('rk_s', [0x90, 37, 100], true);
    audioEngineHost.input('rk_s', [0x80, 37, 0], true);
    audioEngineHost.onPad({ layerId: `${RACK_ACT_PREFIX}rk_s`, amount: 38, vel: 0.5 });
    expect(sent().map(b => b[1])).toEqual([37, 37, 37]);
    expect(taps).toEqual([]);
  });

  it('random is seeded: the same seed plays the same notes from a fresh start', async () => {
    const run = async () => {
      audioEngineHost.resetForTests();
      audioEngineHost.configure({ act: a => { acts.push(a); audioEngineHost.onPad(a); } });
      await start({ 1: 1, 3: 42 });
      for (let i = 0; i < 12; i++) { audioEngineHost.input('rk_s', [0x90, 36, 100]); audioEngineHost.input('rk_s', [0x80, 36, 0]); }
      return sent().filter(b => (b[0] & 0xf0) === 0x90).map(b => b[1]);
    };
    const a = await run(), b = await run();
    expect(a).toEqual(b);
    expect(a.every(n => n >= 36 && n <= 39)).toBe(true);
    expect(new Set(a).size).toBeGreaterThan(1);
  });

  it('leaves other racks’ notes and a sample player at Index 0 alone', async () => {
    await start({});
    audioEngineHost.input('rk_s', [0x90, 38, 100]);
    audioEngineHost.input('rk_s', [0xb0, 1, 64]);
    expect(sent()).toEqual([[0x90, 38, 100], [0xb0, 1, 64]]);
  });
});
