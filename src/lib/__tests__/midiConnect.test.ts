/**
 * Web MIDI connection: a refusal sticks until someone asks again, a device
 * another app holds is reported, and the last message is kept for the page.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MidiEngine, describeMidiEvent } from '../midiEngine';

type FakeInput = { id: string; name: string; state: string; connection: string; onmidimessage: ((e: unknown) => void) | null; open: () => Promise<unknown> };

function fakeInput(name: string, busy = false): FakeInput {
  const input: FakeInput = {
    id: name, name, state: 'connected', connection: 'closed', onmidimessage: null,
    open: () => (busy ? Promise.reject(new Error('InvalidAccessError')) : Promise.resolve().then(() => { input.connection = 'open'; return input; })),
  };
  return input;
}

function withMidi(request: () => Promise<unknown>) {
  vi.stubGlobal('navigator', { requestMIDIAccess: vi.fn(request) });
  return new MidiEngine();
}

const flush = () => new Promise(r => setTimeout(r, 0));

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Web MIDI connection', () => {
  it('listens to every input and keeps the last message', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const input = fakeInput('Launchkey');
    const engine = withMidi(async () => ({ inputs: new Map([['a', input]]), addEventListener() {} }));
    expect(await engine.connectWebMidi()).toBe('ready');
    expect(engine.webMidi().inputs).toEqual(['Launchkey']);
    input.onmidimessage!({ data: new Uint8Array([0xb0, 21, 64]) });
    expect(engine.lastActivity()?.text).toBe('CC 21 = 64 · ch 1');
    expect(engine.channelState(0).seenCc[21]).toBe(1);
  });

  it('shares one request between callers while the prompt is open', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    let resolve!: (v: unknown) => void;
    const engine = withMidi(() => new Promise(r => { resolve = r; }));
    const a = engine.connectWebMidi();
    const b = engine.connectWebMidi();
    expect(engine.webMidi().status).toBe('requesting');
    resolve({ inputs: new Map(), addEventListener() {} });
    expect(await a).toBe('ready');
    expect(await b).toBe('ready');
    expect((navigator as unknown as { requestMIDIAccess: ReturnType<typeof vi.fn> }).requestMIDIAccess).toHaveBeenCalledTimes(1);
  });

  it('a refusal sticks until someone asks again', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    let allow = false;
    const engine = withMidi(async () => { if (!allow) throw new Error('NotAllowedError'); return { inputs: new Map(), addEventListener() {} }; });
    expect(await engine.connectWebMidi()).toBe('denied');
    expect(engine.blockReason()).toMatch(/refused/);
    allow = true;
    expect(await engine.connectWebMidi()).toBe('denied');
    expect(await engine.connectWebMidi({ retry: true })).toBe('ready');
  });

  it('says when another app holds a device', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const engine = withMidi(async () => ({ inputs: new Map([['a', fakeInput('APC40', true)], ['b', fakeInput('Keys')]]), addEventListener() {} }));
    await engine.connectWebMidi();
    await flush(); await flush();
    expect(engine.webMidi().busy).toEqual(['APC40']);
    expect(engine.blockReason()).toMatch(/APC40.*another app/);
  });

  it('describes messages the way the page shows them', () => {
    expect(describeMidiEvent({ kind: 'noteOn', channel: 10, note: 36, velocity: 99 })).toBe('C2 (note 36) · vel 99 · ch 10');
    expect(describeMidiEvent({ kind: 'bend', channel: 1, value: -0.5 })).toBe('bend -0.50 · ch 1');
  });
});
