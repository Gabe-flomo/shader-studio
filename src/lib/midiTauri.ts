/**
 * midiTauri.ts — MIDI in the desktop app, through the Rust bridge
 * (src-tauri/src/midi.rs, `midir` on CoreMIDI). WKWebView has no Web MIDI.
 *
 * Commands: midi_list, midi_open_input / midi_close_input, midi_send (opens
 * the output on first use). Incoming messages arrive as `midi://message`
 * events `{ device, bytes, timestamp }`.
 *
 * Hot-plug: once connected, the port list is read again every couple of
 * seconds while the window is visible (listing CoreMIDI ports is cheap), new
 * inputs are opened and vanished ones closed, and `devices` fires when the
 * list changes. A controller plugged in mid-performance just starts working.
 */

import type { MidiBackendStatus, MidiOutPort, MidiSink, MidiTransport } from './midiTransport';

export const MIDI_MESSAGE_EVENT = 'midi://message';
export const MIDI_POLL_MS = 2000;

interface Port { id: string; name: string }
interface Ports { inputs: Port[]; outputs: Port[] }
export interface NativeMidiMessage { device: string; bytes: number[]; timestamp: number }

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

export class TauriMidiTransport implements MidiTransport {
  readonly kind = 'native' as const;
  private state: MidiBackendStatus = 'idle';
  private invoke: Invoke | null = null;
  private unlisten: (() => void) | null = null;
  private pending: Promise<MidiBackendStatus> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private refreshing: Promise<void> | null = null;
  private inPorts: Port[] = [];
  private outPorts: Port[] = [];
  /** Input ids the Rust side has open. */
  private open = new Set<string>();
  private busyNames: string[] = [];
  private warned = new Set<string>();
  private off = new Set<string>();
  private error = '';

  private sink: MidiSink;
  constructor(sink: MidiSink) { this.sink = sink; }

  status(): MidiBackendStatus { return this.state; }
  inputs(): string[] { return this.inPorts.map(p => p.name); }
  busy(): string[] { return this.busyNames; }

  blockReason(): string | null {
    if (this.state === 'denied') return `The desktop app couldn't start MIDI${this.error ? `: ${this.error}` : ''}. Press Connect to try again.`;
    if (this.busyNames.length) return `Couldn't open ${this.busyNames.join(', ')}. Unplug it and plug it back in, or press Connect.`;
    return null;
  }

  async connect(opts: { retry?: boolean } = {}): Promise<MidiBackendStatus> {
    if (this.state === 'ready') {
      if (opts.retry) { this.warned.clear(); await this.refresh(true); }
      return 'ready';
    }
    if (this.pending) return this.pending;
    if (this.state === 'denied' && !opts.retry) return 'denied';
    this.state = 'requesting';
    this.sink.devices(this.inputs());
    this.pending = (async () => {
      try {
        const [{ invoke }, { listen }] = await Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/event')]);
        this.invoke = invoke as Invoke;
        if (!this.unlisten) this.unlisten = await listen<NativeMidiMessage>(MIDI_MESSAGE_EVENT, e => this.receive(e.payload));
        await this.invoke<Ports>('midi_list'); // fails here, not silently later, if CoreMIDI won't start
        this.state = 'ready';
        this.error = '';
        await this.refresh(true);
        this.startPolling();
        console.info(this.inPorts.length ? `[midi] Desktop: listening to ${this.inputs().join(', ')}` : '[midi] Desktop: no MIDI inputs are connected');
      } catch (e) {
        console.warn('[midi] The desktop MIDI bridge failed:', e);
        this.error = e instanceof Error ? e.message : String(e);
        this.state = 'denied';
        this.sink.devices([]);
      }
      this.pending = null;
      return this.state;
    })();
    return this.pending;
  }

  setDeviceEnabled(name: string, on: boolean): void {
    if (on) this.off.delete(name); else this.off.add(name);
    if (this.state === 'ready') void this.refresh(true);
  }

  outputsNamed(name: string): MidiOutPort[] {
    const invoke = this.invoke;
    if (!invoke) return [];
    return this.outPorts
      .filter(p => p.name === name)
      .map(p => ({ name, send: (data: number[]) => { invoke('midi_send', { id: p.id, bytes: data }).catch(() => { /* the port went away */ }); } }));
  }

  /** One message from the bridge. */
  receive(p: NativeMidiMessage | null | undefined): void {
    const b = p?.bytes;
    if (!Array.isArray(b) || b.length === 0) return;
    this.sink.bytes(b[0], b[1] ?? 0, b[2] ?? 0, p?.device ?? '');
  }

  /** Read the ports again, open new inputs, close vanished or switched-off ones. */
  refresh(force = false): Promise<void> {
    if (this.refreshing) return this.refreshing.then(() => (force ? this.refresh(true) : undefined));
    this.refreshing = this.doRefresh(force).finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  private async doRefresh(force: boolean): Promise<void> {
    const invoke = this.invoke;
    if (!invoke) return;
    let ports: Ports;
    try { ports = await invoke<Ports>('midi_list'); } catch { return; }
    const before = this.signature();
    this.inPorts = Array.isArray(ports?.inputs) ? ports.inputs : [];
    this.outPorts = Array.isArray(ports?.outputs) ? ports.outputs : [];
    const wanted = new Set(this.inPorts.filter(p => !this.off.has(p.name)).map(p => p.id));
    for (const id of [...this.open]) {
      if (wanted.has(id)) continue;
      this.open.delete(id);
      invoke('midi_close_input', { id }).catch(() => { /* already gone */ });
    }
    const busy: string[] = [];
    for (const p of this.inPorts) {
      if (!wanted.has(p.id) || this.open.has(p.id)) continue;
      try {
        await invoke('midi_open_input', { id: p.id });
        this.open.add(p.id);
        this.warned.delete(p.name);
      } catch (e) {
        busy.push(p.name);
        if (!this.warned.has(p.name)) { this.warned.add(p.name); console.warn(`[midi] Couldn't open "${p.name}":`, e); }
      }
    }
    this.busyNames = busy;
    if (force || this.signature() !== before) this.sink.devices(this.inputs());
  }

  private signature(): string {
    return JSON.stringify([this.inPorts, this.outPorts.map(p => p.name), this.busyNames]);
  }

  private startPolling(): void {
    if (this.timer || typeof setInterval === 'undefined') return;
    this.timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void this.refresh();
    }, MIDI_POLL_MS);
  }
}
