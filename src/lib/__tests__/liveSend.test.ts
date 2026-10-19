/**
 * Playfield Send in the page (docs/playfield-send-plan.md, phase 2): the chunk the desktop app
 * sends every 10 ms, the worklet's jitter buffer (drop / pad / underrun), and the client: names
 * (Live connector → name set here → plug-in's → "Send 4821"), subscriptions (tap, idle sweep),
 * chunks routed to each ID's worklet, and the fake sender.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = globalThis;
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); }, key: () => null, length: 0, clear: () => store.clear() });
});

/** A fake Web Audio context with an AudioWorklet, and AudioWorkletNodes that record what they are sent. */
const audio = vi.hoisted(() => {
  const posted: Array<{ node: FakeWorklet; data: unknown }> = [];
  class FakeWorklet {
    context: unknown;
    name: string;
    options: unknown;
    connected: unknown[] = [];
    port = { onmessage: null as ((e: { data: unknown }) => void) | null, postMessage: (data: unknown) => { posted.push({ node: this, data }); } };
    constructor(ctx: unknown, name: string, options: unknown) { this.context = ctx; this.name = name; this.options = options; }
    connect<T>(x: T): T { this.connected.push(x); return x; }
    disconnect() {}
  }
  const node = () => ({ connect<T>(x: T): T { return x; }, disconnect() {}, gain: { value: 1 }, fftSize: 0, smoothingTimeConstant: 0 });
  const modules: string[] = [];
  const ctx = {
    sampleRate: 48000, state: 'running', destination: {},
    audioWorklet: { addModule: async (url: string) => { modules.push(url); } },
    createGain: node, createAnalyser: node,
  };
  (globalThis as unknown as Record<string, unknown>).AudioWorkletNode = FakeWorklet;
  return { ctx, posted, modules, FakeWorklet };
});
vi.mock('../audioEngine', () => ({ audioEngine: { context: () => audio.ctx } }));

import { decodeLiveSendChunk, encodeLiveSendChunk, makeJitter, RECEIVE_SOURCE } from '../liveSendChunk';
import { liveSend, olderVersion, sendIdOfInput, sendReaderInput, type LiveSendInstance } from '../liveSend';
import { sendLabel } from '../liveSendNames';
import { liveClient } from '../liveClient';

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0)); };

function inst(id: number, o: Partial<LiveSendInstance> = {}): LiveSendInstance {
  return { key: `/pfsend.1.${id}`, id, name: '', sampleRate: 48000, status: 'streaming', level: 0.2, dropouts: 0, version: '1.0.0', pid: 1, subscribed: false, ...o };
}

describe('the chunk', () => {
  it('reads the layout the Rust side writes: [u32 LE length][padded JSON][f32 LE PCM per part]', () => {
    // Built by hand, byte by byte, to the spec in src-tauri/src/live_send.rs encode_chunk.
    const json = JSON.stringify({ seq: 3, rate: 44100, s: [{ id: 4821, n: 2, drop: 0 }, { id: 7, n: 1, drop: 5 }] });
    const padded = json + ' '.repeat((4 - (json.length % 4)) % 4);
    const pcm = [0.5, -0.5, 0.25, -0.25, 1, -1];
    const buf = new ArrayBuffer(4 + padded.length + pcm.length * 4);
    const v = new DataView(buf);
    v.setUint32(0, padded.length, true);
    for (let i = 0; i < padded.length; i++) v.setUint8(4 + i, padded.charCodeAt(i));
    pcm.forEach((x, i) => v.setFloat32(4 + padded.length + i * 4, x, true));
    const c = decodeLiveSendChunk(buf)!;
    expect(c.header.rate).toBe(44100);
    expect(c.header.s.map(p => p.id)).toEqual([4821, 7]);
    expect([...c.pcm[0]]).toEqual([0.5, -0.5, 0.25, -0.25]);
    expect([...c.pcm[1]]).toEqual([1, -1]);
    // Each part is its own buffer (transferable on its own).
    expect(c.pcm[0].buffer).not.toBe(c.pcm[1].buffer);
  });

  it('round-trips through the encoder, and refuses truncated or garbage chunks', () => {
    const a = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const buf = encodeLiveSendChunk({ seq: 1, rate: 48000, s: [{ id: 1, n: 2, drop: 0 }] }, [a]);
    expect([...decodeLiveSendChunk(buf)!.pcm[0]]).toEqual([...a]);
    expect(decodeLiveSendChunk(buf.slice(0, buf.byteLength - 4))).toBeNull();
    expect(decodeLiveSendChunk(new ArrayBuffer(2))).toBeNull();
    const junk = new ArrayBuffer(12);
    new DataView(junk).setUint32(0, 8, true);
    expect(decodeLiveSendChunk(junk)).toBeNull();
  });
});

describe('the jitter buffer (the worklet runs the same source)', () => {
  const Q = 128;
  const frames = (n: number, from = 0) => { const p = new Float32Array(n * 2); for (let i = 0; i < n; i++) { p[i * 2] = from + i; p[i * 2 + 1] = -(from + i); } return p; };
  const pull = (j: ReturnType<typeof makeJitter>) => { const l = new Float32Array(Q), r = new Float32Array(Q); const ok = j.pull(l, r, Q); return { ok, l, r }; };

  it('waits for the cushion, then plays in order', () => {
    const j = makeJitter(48000, 1440); // 30 ms at 48 kHz
    j.push(frames(480));
    expect(pull(j).ok).toBe(false); // still priming: silence
    j.push(frames(1000, 480));
    const a = pull(j);
    expect(a.ok).toBe(true);
    expect(a.l[0]).toBe(0);
    expect(a.l[127]).toBe(127);
    expect(a.r[5]).toBe(-5);
    expect(pull(j).l[0]).toBe(128);
  });

  it('a slower page clock: the buffer grows past 2× the cushion and drops back to it', () => {
    const j = makeJitter(48000, 1440);
    j.push(frames(1500));
    pull(j);
    j.push(frames(1600, 1500)); // a burst after a stall
    expect(j.fill).toBe(1440);
    expect(j.drops).toBe(1);
    // It keeps the newest audio.
    expect(pull(j).l[Q - 1]).toBe(3099 - 1440 + Q);
  });

  it('a faster page clock: under half the cushion it pads one quantum; empty is an underrun and it re-primes', () => {
    const j = makeJitter(48000, 1024);
    j.push(frames(1024));
    for (let i = 0; i < 4; i++) expect(pull(j).ok).toBe(true); // 512 left
    expect(pull(j).ok).toBe(true); // 384 left, under 512
    expect(pull(j).ok).toBe(false);
    expect(j.pads).toBe(1);
    expect(j.fill).toBe(384);
    // Nothing comes: it pads until empty-ish; then a real gap is an underrun.
    const k = makeJitter(48000, 256);
    k.push(frames(256));
    pull(k); // 128 left = half: plays
    expect(pull(k).ok).toBe(true); // 0 left
    expect(pull(k).ok).toBe(false);
    expect(k.underruns).toBe(1);
    expect(k.running).toBe(false);
  });

  it('absorbs ±200 ppm of clock drift over ten simulated minutes, staying near the cushion', () => {
    for (const ppm of [200, -200]) {
      const j = makeJitter(96000, 1440);
      const l = new Float32Array(Q), r = new Float32Array(Q);
      let owed = 0, played = 0, minFill = Infinity, maxFill = 0;
      // 10 ms chunks from Live's clock; render quanta on the page's (one quantum ≈ 2.67 ms).
      for (let ms = 0; ms < 600_000; ms += 10) {
        owed += 480 * (1 + ppm / 1e6);
        const n = Math.floor(owed);
        owed -= n;
        j.push(frames(n));
        while (played + Q <= (ms + 10) * 48) { j.pull(l, r, Q); played += Q; if (j.running) { minFill = Math.min(minFill, j.fill); maxFill = Math.max(maxFill, j.fill); } }
      }
      expect(j.underruns, `${ppm} ppm`).toBe(0);
      expect(maxFill, `${ppm} ppm`).toBeLessThanOrEqual(2 * 1440 + 480);
      expect(minFill, `${ppm} ppm`).toBeGreaterThanOrEqual(0);
      // 200 ppm of 10 minutes is 5760 frames: a handful of drops (or pads), not a stream of them.
      if (ppm > 0) { expect(j.drops).toBeGreaterThan(0); expect(j.drops).toBeLessThan(20); } else { expect(j.pads).toBeGreaterThan(0); expect(j.pads).toBeLessThan(100); }
    }
  });

  it('the worklet module has the processor and the jitter buffer in one file', () => {
    expect(RECEIVE_SOURCE).toContain("registerProcessor('playfield-receive'");
    expect(RECEIVE_SOURCE).toContain('class PfJitter');
  });
});

describe('the client', () => {
  const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
  let now = 0;
  beforeEach(() => {
    calls.length = 0;
    audio.posted.length = 0;
    now = 1000;
    liveSend.resetForTests();
    liveSend.invokeHook = (cmd, args) => { calls.push({ cmd, args }); };
    liveSend.contextHook = () => audio.ctx as unknown as BaseAudioContext;
    liveSend.now = () => now;
    (globalThis as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });
  afterEach(() => {
    liveSend.resetForTests();
    delete (globalThis as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it('reader inputs and versions', () => {
    expect(sendReaderInput(4821)).toBe('send:4821');
    expect(sendIdOfInput('send:4821')).toBe(4821);
    expect(sendIdOfInput('send:')).toBeNull();
    expect(sendIdOfInput('video:x')).toBeNull();
    expect(olderVersion('1.0.0', '1.1.0')).toBe(true);
    expect(olderVersion('1.10.0', '1.9.0')).toBe(false);
    expect(olderVersion('1.0.0', '1.0.0')).toBe(false);
  });

  it('names: the Live connector’s track, else a name set here, else the plug-in’s, else "Send 4821"; and they go to the app', () => {
    liveSend.setList([inst(4821), inst(1207, { name: 'Bus' }), inst(9)]);
    expect(liveSend.label(4821)).toBe('Send 4821');
    expect(liveSend.label(1207)).toBe('Bus');
    liveSend.setUserName(4821, '  Kick room  ');
    expect(liveSend.label(4821)).toBe('Kick room');
    expect(JSON.parse(localStorage.getItem('shader-studio:liveSend:names')!)).toEqual([[4821, 'Kick room']]);
    liveSend.setPairs([{ id: 4821, track: 'Drums', colour: 0xff5a36, trackIndex: 0, kind: 'track' }]);
    expect(liveSend.label(4821)).toBe('Drums');
    expect(liveSend.sourceName(4821)).toBe('Live · Drums');
    expect(liveSend.colour(4821)).toBe('#ff5a36');
    expect(liveSend.pairedByLive(4821)).toBe(true);
    // The light naming module (play/readerControls.ts uses it) follows.
    expect(sendLabel(4821)).toBe('Drums');
    const names = calls.filter(c => c.cmd === 'live_send_names').at(-1)!.args.names as Array<{ id: number; label: string; colour: number | null }>;
    expect(names).toContainEqual({ id: 4821, label: 'Drums', colour: 0xff5a36 });
    expect(names).toContainEqual({ id: 1207, label: 'Bus', colour: null });
    expect(names.some(n => n.id === 9)).toBe(false); // nothing to say for "Send 9"
    // A saved label is the fallback for an ID that isn't running.
    expect(liveSend.label(55, 'Old drums')).toBe('Old drums');
  });

  it('the Live connector’s /pf/sends names them', () => {
    liveSend.want('test', true);
    liveClient.inject({ address: '/pf/sends', args: [4821, 'Drums', 0xff0000, 0, 'track', 77, 'A-Reverb', 0x00ff00, 3, 'return'] });
    expect(liveSend.label(4821)).toBe('Drums');
    expect(liveSend.pair(77)?.kind).toBe('return');
    liveClient.inject({ address: '/pf/sends', args: [] });
    expect(liveSend.label(4821)).toBe('Send 4821');
    liveSend.want('test', false);
  });

  it('tap makes the ID’s worklet once, subscribes at the context’s rate, routes chunks to it, and lets go when idle', async () => {
    liveSend.want('test', true);
    liveSend.setList([inst(4821), inst(7)]);
    expect(liveSend.tap(4821)).toBeNull(); // being made
    await settle();
    const node = liveSend.tap(4821) as unknown as InstanceType<typeof audio.FakeWorklet>;
    expect(node).toBeInstanceOf(audio.FakeWorklet);
    expect(node.name).toBe('playfield-receive');
    expect((node.options as { processorOptions: { cushionMs: number } }).processorOptions.cushionMs).toBe(30);
    expect(audio.modules.length).toBe(1);
    expect(calls.filter(c => c.cmd === 'live_send_subscribe').at(-1)!.args).toEqual({ ids: [4821], rate: 48000 });
    expect(liveSend.analyser(4821)).not.toBeNull();
    // A chunk with two parts: only the tapped ID has a worklet.
    liveSend.onChunk(encodeLiveSendChunk({ seq: 1, rate: 48000, s: [{ id: 4821, n: 2, drop: 0 }, { id: 7, n: 1, drop: 0 }] }, [new Float32Array([1, 2, 3, 4]), new Float32Array([9, 9])]));
    const pcm = audio.posted.filter(p => p.node === node && p.data instanceof Float32Array);
    expect(pcm.length).toBe(1);
    expect([...(pcm[0].data as Float32Array)]).toEqual([1, 2, 3, 4]);
    expect(liveSend.chunkCount()).toBe(1);
    // The worklet's stats come back.
    node.port.onmessage?.({ data: { fill: 1440, target: 1440, drops: 0, pads: 1, underruns: 0 } });
    expect(liveSend.bufferStats(4821)?.pads).toBe(1);
    // The cushion setting reaches it.
    liveSend.setCushionMs(60);
    expect(audio.posted.some(p => p.node === node && (p.data as { cushionMs?: number }).cushionMs === 60)).toBe(true);
    liveSend.setCushionMs(30);
    // Nobody taps it for two seconds: unsubscribed.
    now += 2500;
    (liveSend as unknown as { sweepIdle(): void }).sweepIdle();
    expect(calls.filter(c => c.cmd === 'live_send_subscribe').at(-1)!.args).toEqual({ ids: [], rate: 48000 });
    expect(audio.posted.some(p => p.node === node && p.data === 'stop')).toBe(true);
    liveSend.want('test', false);
  });

  it('the fake sender plays a tone through the same path', async () => {
    vi.useFakeTimers();
    try {
      delete (globalThis as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
      liveSend.invokeHook = null;
      liveSend.now = () => Date.now(); // the fake paces itself by the wall clock
      expect(liveSend.available()).toBe(false); // a browser
      const stop = liveSend.startFakeLiveSends([{ id: 4821, track: 'Drums', hz: 100 }, { id: 1207, name: 'Bass bus' }]);
      expect(liveSend.available()).toBe(true);
      expect(liveSend.list().map(i => i.id)).toEqual([4821, 1207]);
      expect(liveSend.label(4821)).toBe('Drums');
      expect(liveSend.label(1207)).toBe('Bass bus');
      liveSend.tap(4821);
      await vi.advanceTimersByTimeAsync(5);
      expect(liveSend.tap(4821)).not.toBeNull();
      await vi.advanceTimersByTimeAsync(100);
      const sent = audio.posted.filter(p => p.data instanceof Float32Array).map(p => p.data as Float32Array);
      expect(sent.length).toBeGreaterThanOrEqual(9);
      // About 100 ms at 48 kHz, stereo, whatever the timers' jitter.
      const total = sent.reduce((a, x) => a + x.length / 2, 0);
      expect(total).toBeGreaterThan(4000);
      expect(total).toBeLessThan(5400);
      expect(Math.max(...sent.flatMap(s => [...s]).map(Math.abs))).toBeGreaterThan(0.1);
      stop();
      expect(liveSend.available()).toBe(false);
      expect(liveSend.list()).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
});
