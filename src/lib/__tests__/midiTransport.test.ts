/**
 * The MIDI transport: Web MIDI in a browser, the Rust bridge in the desktop
 * app, and messages from either reaching the engine with their device name.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  handler: null as ((e: { payload: unknown }) => void) | null,
  ports: { inputs: [] as Array<{ id: string; name: string; manufacturer?: string; offline?: boolean }>, outputs: [] as Array<{ id: string; name: string; offline?: boolean }> },
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

describe('desktop MIDI bridge: ports by id', () => {
  it('opens two devices with one name separately, names a nameless port, and leaves offline ones closed but listed', async () => {
    bridge.ports = {
      inputs: [
        { id: '101', name: 'MPK mini 3', manufacturer: 'Akai', offline: false },
        { id: '102', name: 'MPK mini 3', manufacturer: 'Akai', offline: false },
        { id: '103', name: '', manufacturer: '', offline: false },
        { id: '104', name: 'Ableton Push 3', manufacturer: 'Ableton', offline: true },
      ],
      outputs: [{ id: '201', name: 'MPK mini 3', offline: false }, { id: '202', name: 'Ableton Push 3', offline: true }],
    };
    const devices = vi.fn();
    const t = new TauriMidiTransport({ bytes() {}, devices });
    await t.connect();
    const opened = bridge.invoke.mock.calls.filter(c => c[0] === 'midi_open_input').map(c => (c[1] as { id: string }).id);
    expect(opened).toEqual(['101', '102', '103']);
    expect(t.inputs()).toEqual(['MPK mini 3', 'MPK mini 3', 'MIDI port 103']);
    expect(t.sources()).toEqual([
      { id: '101', name: 'MPK mini 3', manufacturer: 'Akai', offline: false, open: true, note: '' },
      { id: '102', name: 'MPK mini 3', manufacturer: 'Akai', offline: false, open: true, note: '' },
      { id: '103', name: 'MIDI port 103', manufacturer: '', offline: false, open: true, note: '' },
      { id: '104', name: 'Ableton Push 3', manufacturer: 'Ableton', offline: true, open: false, note: '' },
    ]);
    // Pad lights for a name go to every connected output with it, never an offline one.
    expect(t.outputsNamed('MPK mini 3')).toHaveLength(1);
    expect(t.outputsNamed('Ableton Push 3')).toEqual([]);
    // The Push comes online: it's opened on the next scan, and devices fires once for the change.
    devices.mockClear();
    bridge.ports = { ...bridge.ports, inputs: bridge.ports.inputs.map(p => (p.id === '104' ? { ...p, offline: false } : p)) };
    await t.refresh();
    expect(bridge.invoke).toHaveBeenCalledWith('midi_open_input', { id: '104' });
    expect(devices).toHaveBeenCalledTimes(1);
    expect(t.inputs()).toContain('Ableton Push 3');
    // Switching a name off closes both ports with it and says so in the sources.
    t.setDeviceEnabled('MPK mini 3', false);
    await flush();
    const closed = bridge.invoke.mock.calls.filter(c => c[0] === 'midi_close_input').map(c => (c[1] as { id: string }).id).sort();
    expect(closed).toEqual(['101', '102']);
    expect(t.sources().filter(s => s.name === 'MPK mini 3').map(s => s.note)).toEqual(['switched off here', 'switched off here']);
  });

  it('an input that fails to open says why in its source, and a nothing-there list is fine', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    bridge.ports = { inputs: [{ id: '1', name: 'Keys' }], outputs: [] };
    bridge.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'midi_open_input') throw 'Keys is offline (not plugged in)';
      return cmd === 'midi_list' ? bridge.ports : undefined;
    });
    const t = new TauriMidiTransport({ bytes() {}, devices() {} });
    await t.connect();
    expect(t.sources()[0]).toMatchObject({ open: false, note: 'Keys is offline (not plugged in)' });
    expect(t.busy()).toEqual(['Keys']);
    bridge.ports = { inputs: [], outputs: [] };
    bridge.invoke.mockImplementation(async (cmd: string) => (cmd === 'midi_list' ? bridge.ports : undefined));
    await t.refresh();
    expect(t.sources()).toEqual([]);
    expect(t.inputs()).toEqual([]);
  });

  it('channel messages reach the engine; sysex, clock and program change reach the monitor only', async () => {
    const { midiMonitor } = await import('../midiMonitor');
    midiMonitor.clear();
    bridge.ports = { inputs: [{ id: '101', name: 'MPK mini 3', manufacturer: 'Akai' }], outputs: [] };
    const engine = new MidiEngine({ tauri: true });
    await engine.connectWebMidi();
    bridge.handler?.({ payload: { device: 'MPK mini 3', id: '101', bytes: [0xf0, 0x47, 0x7f, 0x49, 0xf7], len: 5, timestamp: 1 } });
    bridge.handler?.({ payload: { device: 'MPK mini 3', id: '101', bytes: [0xf0, 0x47], len: 300, timestamp: 2 } });
    bridge.handler?.({ payload: { device: 'MPK mini 3', id: '101', bytes: [0xf8], timestamp: 3 } });
    bridge.handler?.({ payload: { device: 'MPK mini 3', id: '101', bytes: [0x99, 36, 100], timestamp: 4 } });
    bridge.handler?.({ payload: { device: 'MPK mini 3', id: '101', bytes: [0xc0, 3], timestamp: 5 } });
    expect(engine.lastActivity()?.text).toBe('C2 (note 36) · vel 100 · ch 10');
    const log = midiMonitor.list('MPK mini 3');
    expect(log.map(e => e.bytes)).toEqual([[0xf0, 0x47, 0x7f, 0x49, 0xf7], [0xf0, 0x47], [0xf8], [0x99, 36, 100], [0xc0, 3]]);
    expect(log[1]).toMatchObject({ id: '101', len: 300 });
    expect(engine.sources()).toEqual([{ id: '101', name: 'MPK mini 3', manufacturer: 'Akai', offline: false, open: true, note: '' }]);
  });
});
