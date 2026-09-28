/**
 * The Audio engine in renders and recordings (lib/engineRender.ts,
 * engineExport.ts, engineSend.ts, recordingAudio.ts): a take turned into the
 * native render job (racks, notes at their seconds, parameter steps), the
 * native reply decoded, the rendered sound lined up in an offline mix (a real
 * OfflineAudioContext, node-web-audio-api: nothing is heard), sends taking
 * their tracks out of the mix, the tap's offset for a real-time recording,
 * and the host against a fake bridge.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { OfflineAudioContext as NodeOffline } from 'node-web-audio-api';

vi.hoisted(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = globalThis;
  g.dispatchEvent = () => true;
  const store = new Map<string, string>();
  g.localStorage = { get length() { return store.size; }, key: (i: number) => [...store.keys()][i] ?? null, getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); }, clear: () => store.clear() };
});

import {
  PARAM_STEP, decodeEngineRender, engineRenderJob, engineRenderLead, engineTapOffset, interleave, jobNotes, jobParams, jobRack, noteBytes, type EngineRender,
} from '../../lib/engineRender';
import { engineTracks, mixBuffers, sendFx, sentTracks, type RecordingTrack } from '../../lib/recordingAudio';
import { sendChoices, sendLabel } from '../../lib/engineSend';
import { audioEngineHost, useEngineUi } from '../../lib/audioEngineHost';
import { AE_INST, RACK_ACT_PREFIX, auTarget, fourCC, isSendSource, newRack, parseAudioEngine, type AeRack, type PlayAudioEngine } from '../../types/playAudioEngine';
import { encodeKeys } from '../../lib/takePlayback';
import type { PlayLayer, PlayTake } from '../../types/play';
import { usePlan } from '../../lib/plan';

const RATE = 48000;
const DLS = { type: fourCC('aumu'), subtype: fourCC('dls '), manufacturer: fourCC('appl'), name: 'DLSMusicDevice', vendor: 'Apple' };
const DELAY = { type: fourCC('aufx'), subtype: fourCC('dely'), manufacturer: fourCC('appl'), name: 'AUDelay', vendor: 'Apple' };

function rack(over: Partial<AeRack> = {}): AeRack {
  return { ...newRack('rk_a', []), instrument: { id: AE_INST, kind: 'au', unit: DLS, params: { 3: 0.5 } }, effects: [{ id: 'fx_d', kind: 'au', unit: DELAY, bypass: true, state: 'QUJD' }], ...over };
}

function take(over: Partial<PlayTake> = {}): PlayTake {
  return { id: 'tk', name: 'Take', from: 10, length: 4, tracks: [], events: [], ...over };
}

/** The native reply, packed as render.rs does. */
function reply(info: Record<string, unknown>, left: number[], right: number[]): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(info));
  const out = new Uint8Array(4 + json.length + (left.length + right.length) * 4);
  const v = new DataView(out.buffer);
  v.setUint32(0, json.length, true);
  out.set(json, 4);
  let o = 4 + json.length;
  for (const s of [...left, ...right]) { v.setFloat32(o, s, true); o += 4; }
  return out;
}

beforeAll(() => {
  (globalThis as unknown as { OfflineAudioContext: unknown }).OfflineAudioContext = NodeOffline;
});

// ── The job ─────────────────────────────────────────────────────────────────

describe('the render job', () => {
  it('describes each rack as the record has it, and skips one with nothing to sound', () => {
    const j = jobRack(rack())!;
    expect(j).toMatchObject({ id: 'rk_a', input: false, volume: 1, mute: false });
    expect(j.instrument).toEqual({ id: AE_INST, unit: { type: DLS.type, subtype: DLS.subtype, manufacturer: DLS.manufacturer }, name: 'DLSMusicDevice', params: { 3: 0.5 } });
    expect(j.effects).toEqual([{ id: 'fx_d', unit: { type: DELAY.type, subtype: DELAY.subtype, manufacturer: DELAY.manufacturer }, name: 'AUDelay', bypass: true, state: 'QUJD' }]);
    // The sample player: its zones by sound id.
    const s = jobRack(rack({ instrument: { id: AE_INST, kind: 'sampler', zones: [{ sampleId: 'snd1', name: 'Kick', lo: 36, hi: 36, root: 36, gain: 1 }] } }))!;
    expect(s.instrument).toEqual({ id: AE_INST, name: 'Sample player', zones: [{ sound: 'snd1', lo: 36, hi: 36, root: 36, gain: 1 }] });
    // A send: no instrument, an input.
    const i = jobRack(rack({ source: 'master' }))!;
    expect(i).toMatchObject({ input: true, instrument: null });
    expect(jobRack(rack({ instrument: null }))).toBeNull();
  });

  it('turns the take\'s notes into MIDI at their seconds inside the span, racks\' own and followed pads', () => {
    const racks = [rack(), rack({ id: 'rk_p', pads: 'lyr_pads', instrument: { id: AE_INST, kind: 'sampler', zones: [] } })];
    const t = take({ events: [
      { t: 1, do: 'pad', layerId: `${RACK_ACT_PREFIX}rk_a`, amount: 61, vel: 0.5 },
      { t: 1.5, do: 'pad', layerId: `${RACK_ACT_PREFIX}rk_a`, amount: 61, vel: 0 },
      { t: 0.25, do: 'pad', layerId: 'lyr_pads', amount: 3 },
      { t: 3.9, do: 'pad', layerId: `${RACK_ACT_PREFIX}rk_gone`, amount: 61, vel: 1 },
      { t: 2, do: 'burst', layerId: 'x', amount: 1 },
      { t: 0.5, do: 'pad', layerId: `${RACK_ACT_PREFIX}rk_a`, amount: 200, vel: 1 },
    ] });
    // A render of the take from 0.5 s in, for 3 s: the pad hit at 0.25 is before the span, the note-on at 1 lands at 0.5.
    expect(jobNotes(racks, t, 10.5, 3)).toEqual([
      { t: 0.5, rack: 'rk_a', bytes: [0x90, 60, 64] },
      { t: 1, rack: 'rk_a', bytes: [0x80, 60, 0] },
    ]);
    // From the take's start: the followed pad (pad 3 → note 38) comes first; the note to a rack the record hasn't is dropped.
    expect(jobNotes(racks, t, 10, 4).map(n => [n.t, n.rack, n.bytes[1]])).toEqual([[0.25, 'rk_p', 38], [1, 'rk_a', 60], [1.5, 'rk_a', 60]]);
    expect(noteBytes(60, 1)).toEqual([0x90, 60, 127]);
    expect(noteBytes(60, 0.001)).toEqual([0x90, 60, 1]);
    expect(noteBytes(128, 1)).toBeNull();
    expect(jobNotes(racks, null, 0, 1)).toEqual([]);
  });

  it('samples parameter automation into steps where the value changed', () => {
    // A control on the delay's mix: held at 0.2 for a second, then a ramp to 0.8 over a second, then held.
    const target = auTarget('rk_a', 'fx_d', '5');
    const keys = encodeKeys([0, 1, 2, 4], [0.2, 0.2, 0.8, 0.8], 1);
    const t = take({ tracks: [{ kind: 'control', id: 'c1', target, label: 'Mix', width: 1, keys }, { kind: 'control', id: 'c2', target: 'layer:x::y', label: 'Other', width: 1, keys }] });
    const steps = jobParams([rack()], t, 10, 4);
    expect(steps[0]).toEqual({ t: 0, rack: 'rk_a', slot: 'fx_d', address: '5', value: 0.2 });
    // Nothing during the hold; steps every PARAM_STEP through the ramp; nothing after it settles.
    expect(steps.filter(s => s.t > 0 && s.t < 1)).toEqual([]);
    const ramp = steps.filter(s => s.t >= 1 && s.t <= 2);
    expect(ramp.length).toBeGreaterThan(80);
    expect(ramp.every((s, i) => i === 0 || s.value > ramp[i - 1].value)).toBe(true);
    expect(Math.abs(ramp[1].t - ramp[0].t - PARAM_STEP)).toBeLessThan(1e-6);
    expect(steps.filter(s => s.t > 2.05)).toEqual([]);
    expect(steps.every(s => s.rack === 'rk_a')).toBe(true);
    // A render starting 1.5 s in begins at the ramp's value there.
    expect(jobParams([rack()], t, 11.5, 1)[0]).toMatchObject({ t: 0, value: 0.5 });
  });

  it('makes the whole job, or null when the engine would be silent', () => {
    const ae: PlayAudioEngine = { racks: [rack()] };
    expect(engineRenderJob(ae, take(), 10, 4)).toBeNull();
    expect(engineRenderJob(ae, null, 0, 4)).toBeNull();
    const t = take({ events: [{ t: 1, do: 'pad', layerId: `${RACK_ACT_PREFIX}rk_a`, amount: 61, vel: 1 }] });
    const j = engineRenderJob(ae, t, 10, 4, 44100)!;
    expect(j).toMatchObject({ sampleRate: 44100, seconds: 4 });
    expect(j.racks.map(r => r.id)).toEqual(['rk_a']);
    expect(j.events).toEqual([{ t: 1, rack: 'rk_a', bytes: [0x90, 60, 127] }]);
    // A send makes a job even with no notes (its sound is the input).
    expect(engineRenderJob({ racks: [rack({ source: 'layer:l1' })] }, null, 0, 2)?.racks[0].input).toBe(true);
    expect(engineRenderJob({ racks: [rack({ instrument: null })] }, t, 10, 4)).toBeNull();
    expect(engineRenderJob(ae, t, 10, 0)).toBeNull();
  });
});

// ── The reply and the mix ───────────────────────────────────────────────────

describe('the rendered sound', () => {
  it('decodes the native reply, and refuses a broken one', () => {
    const r = decodeEngineRender(reply({ sampleRate: 48000, frames: 3, latency: { rk_a: 0.01, bad: 'x' }, notes: ['n1', 2], racks: ['rk_a'] }, [0.5, -0.5, 1], [0, 0.25, -1]))!;
    expect(r.sampleRate).toBe(48000);
    expect(r.frames).toBe(3);
    expect([...r.left]).toEqual([0.5, -0.5, 1]);
    expect([...r.right]).toEqual([0, 0.25, -1]);
    expect(r.latency).toEqual({ rk_a: 0.01 });
    expect(r.notes).toEqual(['n1']);
    expect(r.racks).toEqual(['rk_a']);
    expect(engineRenderLead(r)).toBe(0.01);
    expect(engineRenderLead({ latency: {} })).toBe(0);
    expect(decodeEngineRender(new Uint8Array([1, 2]))).toBeNull();
    expect(decodeEngineRender(reply({ frames: 10 }, [0], [0]))).toBeNull(); // says 10 frames, has 1
    const short = reply({ frames: 1 }, [1], [1]);
    expect(decodeEngineRender(short.slice(0, short.length))).not.toBeNull();
  });

  it('puts the render under the mix from 0, slid earlier by the units\' latency, and a mix of the engine alone is a mix', async () => {
    const frames = RATE;
    const click = (at: number): EngineRender => {
      const left = new Float32Array(frames), right = new Float32Array(frames);
      for (let i = at; i < at + 48; i++) { left[i] = 0.8; right[i] = 0.8; }
      return { sampleRate: RATE, frames, left, right, latency: {}, notes: [], racks: ['rk_a'] };
    };
    const where = (b: AudioBuffer) => { const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > 0.1) return i; return -1; };
    // No latency: the click lands where the engine rendered it (frame 24000, half a second).
    const plain = await mixBuffers([], [], 1, 0, RATE, { fx: undefined, engine: click(24000) });
    expect(plain).not.toBeNull();
    expect(Math.abs(where(plain!) - 24000)).toBeLessThanOrEqual(1);
    // A unit reporting 50 ms of latency: the sound is slid 2400 frames earlier.
    const late = click(24000);
    late.latency = { rk_a: 0.05 };
    const fixed = await mixBuffers([], [], 1, 0, RATE, { fx: undefined, engine: late });
    expect(Math.abs(where(fixed!) - (24000 - 2400))).toBeLessThanOrEqual(1);
    // The render's own level survives (straight to the destination, not through the master chain's volume).
    expect(Math.abs(fixed!.getChannelData(1)[24000 - 2400 + 10] - 0.8)).toBeLessThan(0.02);
    // Nothing at all: still nothing.
    expect(await mixBuffers([], [], 1, 0, RATE, { fx: undefined, engine: null })).toBeNull();
  });

  it('interleaves a buffer for a send\'s upload', () => {
    const ctx = new NodeOffline(2, 4, RATE) as unknown as OfflineAudioContext;
    const b = ctx.createBuffer(2, 2, RATE);
    b.getChannelData(0).set([1, 2]);
    b.getChannelData(1).set([3, 4]);
    expect([...interleave(b)]).toEqual([1, 3, 2, 4]);
    const mono = ctx.createBuffer(1, 2, RATE);
    mono.getChannelData(0).set([5, 6]);
    expect([...interleave(mono)]).toEqual([5, 5, 6, 6]);
  });
});

// ── Tracks and sends ────────────────────────────────────────────────────────

describe('engine tracks and sends', () => {
  const song: RecordingTrack = { key: 'layer:l1', label: 'Song', clock: true, chain: 'layer:l1' };
  const vid: RecordingTrack = { key: 'vlayer:v1', label: 'Clip', clock: true, chain: 'layer:v1' };

  it('lists racks with an instrument or a send as tracks, on the desktop engine only', () => {
    const racks = [rack(), rack({ id: 'rk_e', instrument: null }), rack({ id: 'rk_s', instrument: null, source: 'layer:l1', name: 'Send' })];
    expect(engineTracks(racks, true).map(t => [t.key, t.label, t.engine])).toEqual([
      ['engine:rk_a', 'Audio engine · Rack 1', { rackId: 'rk_a' }],
      ['engine:rk_s', 'Audio engine · Send', { rackId: 'rk_s', source: 'layer:l1' }],
    ]);
    expect(engineTracks(racks, false)).toEqual([]);
    expect(engineTracks(undefined, true)).toEqual([]);
  });

  it('takes a sent track out of the direct mix: a chain send its chain, a master send everything', () => {
    const chainSend = engineTracks([rack({ id: 'rk_s', source: 'layer:l1' })], true);
    const a = sentTracks([song, vid, ...chainSend]);
    expect(a.direct.map(t => t.key)).toEqual(['vlayer:v1', 'engine:rk_s']);
    expect(a.sent.get('rk_s')?.map(t => t.key)).toEqual(['layer:l1']);
    const masterSend = engineTracks([rack({ id: 'rk_m', source: 'master' })], true);
    const b = sentTracks([song, vid, ...masterSend]);
    expect(b.direct.map(t => t.key)).toEqual(['engine:rk_m']);
    expect(b.sent.get('rk_m')?.map(t => t.key)).toEqual(['layer:l1', 'vlayer:v1']);
    // No sends: nothing moves.
    expect(sentTracks([song, vid]).direct).toHaveLength(2);
  });

  it('a chain send keeps its chain\'s effects and drops the master chain\'s; a master send keeps both', () => {
    const fx = { chains: { master: { on: true, effects: [] }, 'layer:l1': { on: true, effects: [] } } } as never;
    expect(Object.keys(sendFx(fx, 'layer:l1')!.chains)).toEqual(['layer:l1']);
    expect(Object.keys(sendFx(fx, 'master')!.chains)).toEqual(['master', 'layer:l1']);
    expect(sendFx(undefined, 'layer:l1')).toBeUndefined();
  });

  it('offers everything the page plays and each sounding layer, and names a source', () => {
    const layers = [
      { id: 'l1', kind: 'audio', label: 'Beat', input: 'file' }, { id: 'l2', kind: 'audio', label: 'Mic', input: 'live' },
      { id: 'v1', kind: 'video', label: 'Clip', sound: 'play' }, { id: 'v2', kind: 'video', label: 'Silent', sound: 'off' },
      { id: 'd1', kind: 'drumpad', label: 'Pads' }, { id: 't1', kind: 'text', label: 'Title' },
    ] as unknown as PlayLayer[];
    expect(sendChoices(layers)).toEqual([
      { value: 'master', label: 'Everything the page plays' },
      { value: 'layer:l1', label: 'Beat · song' },
      { value: 'layer:v1', label: 'Clip · video sound' },
      { value: 'layer:d1', label: 'Pads · drum pads' },
    ]);
    expect(sendLabel('layer:d1', layers)).toBe('Pads · drum pads');
    expect(sendLabel('layer:zz', layers)).toBe('layer:zz (gone)');
    expect(sendLabel('master', [])).toBe('Everything the page plays');
  });

  it('the record keeps a send\'s source when it reads as one', () => {
    const raw = { racks: [{ id: 'rk_a', name: 'A', instrument: null, effects: [], source: 'layer:l1' }, { id: 'rk_b', name: 'B', instrument: null, effects: [], source: 'speaker' }] };
    const ae = parseAudioEngine(raw)!;
    expect(ae.racks[0].source).toBe('layer:l1');
    expect(ae.racks[1].source).toBeUndefined();
    expect(isSendSource('master')).toBe(true);
    expect(isSendSource('node:n1')).toBe(true);
    expect(isSendSource('layer:a b')).toBe(false);
  });
});

// ── Real-time recordings ────────────────────────────────────────────────────

describe('the tap\'s offset', () => {
  it('is how much later than the picture the engine\'s file starts', () => {
    // The tap asked for 8 ms before the recorder started, its first buffer 12 ms after that: 4 ms later than the picture.
    expect(engineTapOffset(1000, 0.012, 1008)).toBe(0.004);
    // Asked for after the recorder (a reorder): positive and larger.
    expect(engineTapOffset(1020, 0, 1000)).toBe(0.02);
    expect(engineTapOffset(1000, Number.NaN, 1000)).toBe(0);
    expect(engineTapOffset(0, 100, 0)).toBe(5);
  });
});

// ── The host ────────────────────────────────────────────────────────────────

describe('the host', () => {
  type Call = { cmd: string; args: unknown; options: unknown };
  let calls: Call[];
  beforeEach(() => {
    audioEngineHost.resetForTests();
    calls = [];
    audioEngineHost.configure({
      invoke: vi.fn(async (cmd: string, args?: unknown, options?: unknown) => {
        calls.push({ cmd, args, options });
        switch (cmd) {
          case 'ae_status': return { available: true, sampleRate: 48000 };
          case 'ae_render_take': return reply({ sampleRate: 48000, frames: 2, latency: {}, notes: ['a note'], racks: ['rk_a'] }, [0.1, 0.2], [0.3, 0.4]).buffer;
          case 'ae_tap_start': return { path: '/tmp/engine.wav', sampleRate: 48000 };
          case 'ae_tap_stop': return { path: '/tmp/engine.wav', frames: 96000, sampleRate: 48000, offset: 0.011, lost: 0 };
          case 'ae_rack_input_stats': return { queued: 960, underruns: 0 };
          default: return null;
        }
      }) as never,
      listen: vi.fn(async () => () => {}) as never,
      act: null,
    });
    usePlan.getState().setSession({ status: 'signed-in', user: '', plan: 'pro', source: 'open' });
  });

  it('renders a take: uploads the sends\' sounds, sends the job, decodes the reply', async () => {
    const job = engineRenderJob({ racks: [rack(), rack({ id: 'rk_s', source: 'master' })] }, take({ events: [{ t: 1, do: 'pad', layerId: `${RACK_ACT_PREFIX}rk_a`, amount: 61, vel: 1 }] }), 10, 4)!;
    const pcm = new Float32Array([1, 1, 0.5, 0.5]);
    const out = (await audioEngineHost.renderTake(job, new Map([['rk_s', pcm]])))!;
    expect(calls.map(c => c.cmd)).toEqual(['ae_status', 'ae_master', 'ae_set_output', 'ae_render_input', 'ae_render_take']);
    const up = calls.find(c => c.cmd === 'ae_render_input')!;
    expect(up.options).toEqual({ headers: { 'x-rack': 'rk_s' } });
    expect((up.args as Uint8Array).byteLength).toBe(16);
    expect((calls.find(c => c.cmd === 'ae_render_take')!.args as { job: unknown }).job).toBe(job);
    expect(out.frames).toBe(2);
    expect([...out.left]).toEqual([0.10000000149011612, 0.20000000298023224]);
    expect(out.notes).toEqual(['a note']);
  });

  it('taps the engine for a recording only while the desktop engine runs racks, and muxes afterwards', async () => {
    expect(await audioEngineHost.tapStart()).toBeNull(); // no racks yet
    audioEngineHost.frame({ racks: [rack()] }, []);
    await audioEngineHost.settled();
    expect(audioEngineHost.renders()).toBe(true);
    expect(await audioEngineHost.tapStart()).toEqual({ path: '/tmp/engine.wav', sampleRate: 48000 });
    const done = (await audioEngineHost.tapStop())!;
    expect(done.offset).toBe(0.011);
    await audioEngineHost.mux('/v/rec.mp4', done.path, engineTapOffset(100, done.offset, 105), false);
    expect(calls[calls.length - 1]).toMatchObject({ cmd: 'mux_recording_audio', args: { video: '/v/rec.mp4', wav: '/tmp/engine.wav', offset: 0.006, mix: false } });
    await audioEngineHost.tapDiscard('/tmp/engine.wav');
    expect(calls[calls.length - 1].cmd).toBe('ae_tap_discard');
  });

  it('a send makes the rack an input; without the page\'s sound running it says so, and the instrument comes back when the send goes', async () => {
    audioEngineHost.frame({ racks: [rack({ source: 'layer:l1' })] }, []);
    await audioEngineHost.settled();
    const cmds = calls.map(c => c.cmd);
    expect(cmds).toContain('ae_rack_input');
    expect(cmds).not.toContain('ae_set_instrument');
    expect((calls.find(c => c.cmd === 'ae_rack_input')!.args as { rack: string; capacity: number })).toEqual({ rack: 'rk_a', capacity: 48000 });
    expect(useEngineUi.getState().errors['rk_a/inst']).toMatch(/isn’t running/);
    expect(await audioEngineHost.inputStats('rk_a')).toEqual({ queued: 960, underruns: 0 });
    // The send turned off: the instrument loads.
    calls.length = 0;
    audioEngineHost.frame({ racks: [rack()] }, []);
    await audioEngineHost.settled();
    expect(calls.map(c => c.cmd)).toContain('ae_set_instrument');
  });
});
