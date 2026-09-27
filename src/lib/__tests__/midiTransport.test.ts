/**
 * The MIDI transport: Web MIDI in a browser, the Rust bridge in the desktop
 * app, and messages from either reaching the engine with their device name.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  handler: null as ((e: { payload: unknown }) => void) | null,
  ports: { inputs: [] as Array<{ id: string; name: string }>, outputs: [] as Array<{ id: string; name: string }> },
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_name: string, cb: (e: { payload: unknown }) => void) => { bridge.handler = cb; return () => { bridge.handler = null; }; }),
}));

import { selectMidiTransport, WebMidiTransport } from '../midiTransport';
import { TauriMidiTransport, MIDI_MESSAGE_EVENT } from '../midiTauri';
import { MidiEngine } from '../midiEngine';

const flush = () => new Promise(r => setTimeout(r, 0));
const send = (device: string, bytes: number[]) => bridge.handler?.({ payload: { device, bytes, timestamp: 1 } });

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  bridge.ports = { inputs: [{ id: 'in-1', name: 'Launchpad X' }, { id: 'in-2', name: 'Keystep' }], outputs: [{ id: 'out-1', name: 'Launchpad X' }] };
  bridge.invoke.mockReset();
  bridge.invoke.mockImplementation(async (cmd: string) => (cmd === 'midi_list' ? bridge.ports : undefined));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('transport selection', () => {
  const sink = { bytes() {}, devices() {} };
  it('uses Web MIDI in a browser and the bridge in the desktop app', () => {
    expect(selectMidiTransport(sink, { tauri: false })).toBeInstanceOf(WebMidiTransport);
    expect(selectMidiTransport(sink, { tauri: true })).toBeInstanceOf(TauriMidiTransport);
  });
  it('detects the desktop app from __TAURI_INTERNALS__', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    expect(selectMidiTransport(sink).kind).toBe('native');
    vi.stubGlobal('window', {});
    expect(selectMidiTransport(sink).kind).toBe('web');
  });
});

describe('desktop MIDI bridge', () => {
  it('lists and opens every input, and messages carry the device name', async () => {
    const engine = new MidiEngine({ tauri: true });
    const raw: Array<[number, string]> = [];
    engine.subscribeRaw((status, _d1, _d2, device) => raw.push([status, device]));
    expect(engine.webMidi().status).toBe('idle');
    expect(await engine.connectWebMidi()).toBe('ready');
    expect(engine.webMidi()).toMatchObject({ transport: 'native', inputs: ['Launchpad X', 'Keystep'], busy: [] });
    expect(bridge.invoke).toHaveBeenCalledWith('midi_open_input', { id: 'in-1' });
    expect(bridge.invoke).toHaveBeenCalledWith('midi_open_input', { id: 'in-2' });
    expect(MIDI_MESSAGE_EVENT).toBe('midi://message');
    send('Keystep', [0xb1, 21, 64]);
    expect(engine.lastActivity()?.text).toBe('CC 21 = 64 · ch 2');
    expect(engine.activeInput()).toMatchObject({ kind: 'cc', device: 'Keystep', channel: 2, number: 21 });
    // A knob lock on that device reads it; one on another device doesn't.
    expect(engine.readLocked([{ device: 'Keystep', channel: 2, cc: 21 }])).toBe(64);
    expect(engine.readLocked([{ device: 'Launchpad X', channel: 2, cc: 21 }])).toBeNull();
    send('Launchpad X', [0x90, 11, 127]);
    expect(raw).toEqual([[0xb1, 'Keystep'], [0x90, 'Launchpad X']]);
    // Malformed payloads are ignored.
    bridge.handler?.({ payload: { device: 'x', bytes: [] } });
    bridge.handler?.({ payload: null });
    expect(raw).toHaveLength(2);
  });

  it('sends pad lights to the output with the same name', async () => {
    const engine = new MidiEngine({ tauri: true });
    await engine.connectWebMidi();
    const outs = engine.outputsNamed('Launchpad X');
    expect(outs).toHaveLength(1);
    outs[0].send([0x90, 11, 21]);
    expect(bridge.invoke).toHaveBeenCalledWith('midi_send', { id: 'out-1', bytes: [0x90, 11, 21] });
    expect(engine.outputsNamed('Keystep')).toEqual([]);
  });

  it('a switched-off device is closed and its messages dropped', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
    const engine = new MidiEngine({ tauri: true });
    await engine.connectWebMidi();
    engine.setDeviceEnabled('Keystep', false);
    await flush();
    expect(bridge.invoke).toHaveBeenCalledWith('midi_close_input', { id: 'in-2' });
    expect(engine.webMidi().off).toEqual(['Keystep']);
    send('Keystep', [0x90, 60, 100]);
    expect(engine.lastActivity()).toBeNull();
    engine.setDeviceEnabled('Keystep', true);
    await flush();
    expect(bridge.invoke.mock.calls.filter(c => c[0] === 'midi_open_input' && (c[1] as { id: string }).id === 'in-2')).toHaveLength(2);
  });

  it('hot-plug: a new input is opened, a vanished one closed, and devices fires', async () => {
    const t = new TauriMidiTransport({ bytes() {}, devices: vi.fn() });
    await t.connect();
    bridge.ports = { inputs: [{ id: 'in-2', name: 'Keystep' }, { id: 'in-3', name: 'APC40' }], outputs: [] };
    await t.refresh();
    expect(t.inputs()).toEqual(['Keystep', 'APC40']);
    expect(bridge.invoke).toHaveBeenCalledWith('midi_close_input', { id: 'in-1' });
    expect(bridge.invoke).toHaveBeenCalledWith('midi_open_input', { id: 'in-3' });
    expect(t.outputsNamed('Launchpad X')).toEqual([]);
  });

  it('an input that won\'t open is reported, and a bridge that fails says why', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    bridge.invoke.mockImplementation(async (cmd: string, args?: { id: string }) => {
      if (cmd === 'midi_open_input' && args?.id === 'in-1') throw 'Couldn\'t open Launchpad X';
      return cmd === 'midi_list' ? bridge.ports : undefined;
    });
    const t = new TauriMidiTransport({ bytes() {}, devices() {} });
    await t.connect();
    expect(t.busy()).toEqual(['Launchpad X']);
    expect(t.blockReason()).toMatch(/Launchpad X/);

    bridge.invoke.mockImplementation(async () => { throw 'CoreMIDI said no'; });
    const broken = new TauriMidiTransport({ bytes() {}, devices() {} });
    expect(await broken.connect()).toBe('denied');
    expect(broken.blockReason()).toMatch(/CoreMIDI said no/);
    expect(await broken.connect()).toBe('denied');
    bridge.invoke.mockImplementation(async (cmd: string) => (cmd === 'midi_list' ? bridge.ports : undefined));
    expect(await broken.connect({ retry: true })).toBe('ready');
  });
});
