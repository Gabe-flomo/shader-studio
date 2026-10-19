/**
 * The Audio Source's Live tab (Playfield Send, docs/playfield-send-plan.md phase 2): the `send` kind,
 * a saved `sendId` that isn't running ("Waiting for Playfield Send 4821 (Drums)"), a running one
 * read live like the Mic, never played to the speakers (an effect on it isn't heard), Pro only, and
 * an exported page listening to the visitor's microphone instead.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = globalThis;
  g.dispatchEvent = () => true;
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

const frame = vi.hoisted(() => ({ freq: new Float32Array(1024).fill(-30), wave: new Float32Array(2048).fill(0.4) }));
const fakes = vi.hoisted(() => {
  const analyser = () => ({
    fftSize: 2048, smoothingTimeConstant: 0, connect<T>(x: T): T { return x; }, disconnect() {},
    getFloatFrequencyData(a: Float32Array) { a.set(frame.freq); },
    getFloatTimeDomainData(a: Float32Array) { a.set(frame.wave); },
  });
  const ctx: Record<string, unknown> = {
    sampleRate: 48000, state: 'running', destination: {},
    audioWorklet: { addModule: async () => {} },
    resume: () => Promise.resolve(),
  };
  ctx.createAnalyser = () => ({ ...analyser(), context: ctx });
  ctx.createGain = () => ({ gain: { value: 1 }, connect<T>(x: T): T { return x; }, disconnect() {}, context: ctx });
  class FakeWorklet {
    context = ctx;
    port = { onmessage: null, postMessage: () => {} };
    connect<T>(x: T): T { return x; }
    disconnect() {}
  }
  (globalThis as unknown as Record<string, unknown>).AudioWorkletNode = FakeWorklet;
  const audioEngine = {
    isLoaded: () => false, duration: () => 0, isMasterPaused: () => false, startAudio() {}, stopAudio() {}, removeAudio() {},
    isPlaying: () => false, position: () => 0, getFileName: () => '', getAnalyser: () => null, buffer: () => null,
    context: () => ctx, connectOutside: vi.fn(() => () => {}), setVolume: vi.fn(), positionAt: () => 0, heardTime: () => 0,
    outputLatency: () => 0.02, playToken: () => 1, seek: vi.fn(),
  };
  return { ctx, audioEngine };
});
vi.mock('../../audioEngine', () => ({ audioEngine: fakes.audioEngine, trackChainId: (id: string) => `track:${id}` }));

import type { GraphNode } from '../../../types/nodeGraph';
import { audioToolsEngine } from '../engine';
import { n } from '../../../store/graphBuilder';
import { audioHearing, collectAudioNodes } from '../graphWalk';
import { audioToolsForWeb } from '../webExport';
import { audioSendIdOf, audioSourceKind, isLiveInputKind, retypeAudioSource, AUDIO_SOURCE_TYPE } from '../../../nodes/definitions/audioTools';
import { liveSend } from '../../liveSend';
import { usePlan } from '../../plan';

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0)); };

function source(params: Record<string, unknown>, id = 'src'): GraphNode {
  return { id, type: AUDIO_SOURCE_TYPE, position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { playing: true, gain: 1, bands: [], sounds: [], ...params } } as unknown as GraphNode;
}

function tick(): Map<string, number> {
  const out = new Map<string, number>();
  audioToolsEngine.tickInputs(1 / 60, 0, (k, v) => { if (typeof v === 'number') out.set(k, v); });
  return out;
}

const subs: unknown[] = [];
beforeEach(() => {
  subs.length = 0;
  liveSend.resetForTests();
  liveSend.invokeHook = (cmd, args) => { if (cmd === 'live_send_subscribe') subs.push(args); };
  (globalThis as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  usePlan.setState({ session: { status: 'signed-in', user: '', plan: 'pro', source: 'open' } });
  audioToolsEngine.setHost({ setTexture: () => {}, requestRender: () => {} });
});
afterEach(() => {
  audioToolsEngine.sync([]);
  audioToolsEngine.setHost(null);
  liveSend.resetForTests();
  delete (globalThis as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe('the send kind', () => {
  it('is a source kind with a Pairing ID, kept by retyping; Mic and Live are live input', () => {
    const n = source({ source: 'send', sendId: 4821, sendLabel: 'Drums' });
    expect(audioSourceKind(n)).toBe('send');
    expect(audioSendIdOf(n)).toBe(4821);
    expect(audioSendIdOf(source({ source: 'send', sendId: '' }))).toBeNull();
    expect(audioSendIdOf(source({ source: 'send', sendId: 12345 }))).toBeNull();
    expect(retypeAudioSource(n).params.source).toBe('send');
    expect(isLiveInputKind('send') && isLiveInputKind('mic') && !isLiveInputKind('file')).toBe(true);
  });
});

describe('an Audio Source on the Live tab', () => {
  it('a saved send that isn’t running says what it waits for, and reads silence', () => {
    audioToolsEngine.sync([source({ source: 'send', sendId: 4821, sendLabel: 'Drums' })]);
    const out = tick();
    expect(audioToolsEngine.status('src')).toBe('Waiting for Playfield Send 4821 (Drums): is Live open with it on a track?');
    expect(out.get('src::level')).toBe(0);
  });

  it('a running one is read live once its worklet is up, named after its track, at no output latency', async () => {
    liveSend.setList([{ key: '/pfsend.1.0', id: 4821, name: '', sampleRate: 44100, status: 'streaming', level: 0.3, dropouts: 0, version: '1.0.0', pid: 1, subscribed: true }]);
    liveSend.setPairs([{ id: 4821, track: 'Drums', colour: 0xff0000, trackIndex: 0, kind: 'track' }]);
    audioToolsEngine.sync([source({ source: 'send', sendId: 4821 })]);
    tick();
    await settle();
    const out = tick();
    expect(audioToolsEngine.status('src')).toBe('Live · Drums · streaming');
    expect(out.get('src::level')).toBeGreaterThan(0);
    expect(audioToolsEngine.sourceView('src')?.latencyMs).toBe(0);
    expect(audioToolsEngine.sourceView('src')?.active).toBe(true);
    expect(subs.at(-1)).toEqual({ ids: [4821], rate: 48000 });
    // Paused in Live.
    liveSend.setList([{ key: '/pfsend.1.0', id: 4821, name: '', sampleRate: 44100, status: 'paused', level: 0, dropouts: 0, version: '1.0.0', pid: 1, subscribed: true }]);
    for (let i = 0; i < 16; i++) tick();
    expect(audioToolsEngine.status('src')).toBe('Live · Drums · paused in Live');
  });

  it('is Pro: on Free it is silent and says so', async () => {
    usePlan.setState({ session: { status: 'signed-in', user: 'x', plan: 'free', source: 'gate' } });
    liveSend.setList([{ key: '/pfsend.1.0', id: 4821, name: '', sampleRate: 48000, status: 'streaming', level: 0.3, dropouts: 0, version: '1.0.0', pid: 1, subscribed: false }]);
    audioToolsEngine.sync([source({ source: 'send', sendId: 4821 })]);
    tick();
    await settle();
    const out = tick();
    expect(audioToolsEngine.status('src')).toBe('Live tracks are part of Pro: this source is silent.');
    expect(out.get('src::level')).toBe(0);
    expect(subs).toEqual([]);
  });

  it('is never played: an effect after it with Listen on isn’t heard', () => {
    const refs = collectAudioNodes([n('audioSource', 'src', 0, 0, { source: 'send', sendId: 1 }), n('audioFilter', 'fx', 0, 0, { listen: true }, { audio: ['src', 'audio'] })]);
    const kinds = (id: string) => (id === 'src' ? 'send' : null);
    expect(audioHearing(refs, kinds).heard.has('fx')).toBe(false);
    expect(audioHearing(refs, id => (id === 'src' ? 'file' : null)).heard.has('fx')).toBe(true);
  });

  it('an exported page listens to the visitor’s microphone in its place', () => {
    const web = audioToolsForWeb({ nodes: [source({ source: 'send', sendId: 4821 })], liveUniforms: {}, textureUniforms: {}, videoUniforms: {}, mediaOf: () => null });
    expect(web?.sources[0].kind).toBe('mic');
  });
});
