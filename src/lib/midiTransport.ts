/**
 * midiTransport.ts — where hardware MIDI comes from. The engine (midiEngine.ts)
 * doesn't care: it gets raw messages with the device's name, and the list of
 * inputs when it changes.
 *
 *   - WebMidiTransport: the browser's Web MIDI (Chrome, Edge, Opera).
 *   - TauriMidiTransport (midiTauri.ts): the desktop app, whose WKWebView has
 *     no Web MIDI; the Rust side (src-tauri/src/midi.rs) talks to CoreMIDI.
 *
 * `selectMidiTransport` picks one the way the rest of the app detects Tauri.
 */

import { TauriMidiTransport } from './midiTauri';

export type MidiBackendStatus = 'unsupported' | 'idle' | 'requesting' | 'ready' | 'denied';

/** Where a transport delivers what it receives. */
export interface MidiSink {
  /** One channel message; `device` is the input's name (what knob locks and pad grids match on). */
  bytes(status: number, d1: number, d2: number, device: string): void;
  /** A message the engine doesn't model (sysex, clock, program change…), for the Monitor. `len`: the whole length of a trimmed sysex. */
  raw?(bytes: number[], device: string, id: string, len?: number): void;
  /** The connected inputs changed (plugged, unplugged, opened, refused). */
  devices(inputs: string[]): void;
}

/** One input as the Monitor lists it. */
export interface MidiSourceInfo {
  /** The transport's id (CoreMIDI's unique id in the desktop app, the browser's port id on the web). */
  id: string;
  name: string;
  manufacturer: string;
  /** The system remembers it but it isn't connected. */
  offline: boolean;
  /** We are listening to it. */
  open: boolean;
  /** It's there but couldn't be opened (another app has it), or the user switched it off. */
  note: string;
}

/** A MIDI output to light a controller's pads. */
export interface MidiOutPort {
  readonly name: string;
  send(data: number[]): void;
}

export interface MidiTransport {
  readonly kind: 'web' | 'native';
  status(): MidiBackendStatus;
  /** Connected inputs, by name. */
  inputs(): string[];
  /** Every input the system knows, connected or not, with ids (the Monitor). */
  sources(): MidiSourceInfo[];
  /** Inputs that are there but couldn't be opened (another app has them). */
  busy(): string[];
  /** Ask for access and listen to every input; `retry` asks again after a refusal. */
  connect(opts?: { retry?: boolean }): Promise<MidiBackendStatus>;
  /** Stop or start listening to one input (the engine also drops a switched-off device's messages). */
  setDeviceEnabled(name: string, on: boolean): void;
  outputsNamed(name: string): MidiOutPort[];
  /** Why MIDI can't work here, in words, or null. */
  blockReason(): string | null;
}

export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function selectMidiTransport(sink: MidiSink, opts: { tauri?: boolean } = {}): MidiTransport {
  return (opts.tauri ?? isTauri()) ? new TauriMidiTransport(sink) : new WebMidiTransport(sink);
}

// ─── Web MIDI ────────────────────────────────────────────────────────────────

export class WebMidiTransport implements MidiTransport {
  readonly kind = 'web' as const;
  private access: MIDIAccess | null = null;
  private state: MidiBackendStatus = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator ? 'idle' : 'unsupported';
  private inputNames: string[] = [];
  /** Inputs the browser lists but couldn't open (on Windows: another app, like Ableton, has it). */
  private busyNames: string[] = [];
  private permissionWatched = false;
  private pending: Promise<MidiBackendStatus> | null = null;
  private onMidiMessage = (e: Event) => {
    const data = (e as MIDIMessageEvent).data;
    const input = e.target as MIDIInput | null;
    if (!data || data.length < 1) return;
    const device = input?.name ?? input?.id ?? '';
    if (data[0] >= 0x80 && data[0] < 0xf0) this.sink.bytes(data[0], data[1] ?? 0, data[2] ?? 0, device);
    else this.sink.raw?.(Array.from(data), device, input?.id ?? '');
  };

  private sink: MidiSink;
  constructor(sink: MidiSink) { this.sink = sink; }

  status(): MidiBackendStatus { return this.state; }
  inputs(): string[] { return this.inputNames; }
  busy(): string[] { return this.busyNames; }
  /** The browser keeps every input open; the engine filters a switched-off one. */
  setDeviceEnabled(): void {}

  sources(): MidiSourceInfo[] {
    const out: MidiSourceInfo[] = [];
    this.access?.inputs.forEach(i => {
      const name = i.name ?? i.id;
      out.push({ id: i.id, name, manufacturer: i.manufacturer ?? '', offline: i.state !== 'connected', open: i.connection === 'open', note: this.busyNames.includes(name) ? 'another app has it' : '' });
    });
    return out;
  }

  outputsNamed(name: string): MidiOutPort[] {
    const out: MidiOutPort[] = [];
    this.access?.outputs.forEach(o => {
      if (o.state === 'connected' && (o.name ?? o.id) === name) out.push({ name, send: data => o.send(data) });
    });
    return out;
  }

  blockReason(): string | null {
    if (this.state === 'unsupported') return 'This browser has no Web MIDI (Chrome, Edge and Opera have it; Safari does not). The keyboard stand-in on a MIDI Input node still works.';
    const embedded = typeof window !== 'undefined' && window.self !== window.top;
    const policy = typeof document !== 'undefined'
      ? ((document as unknown as { permissionsPolicy?: { allowsFeature(f: string): boolean }; featurePolicy?: { allowsFeature(f: string): boolean } }).permissionsPolicy
        ?? (document as unknown as { featurePolicy?: { allowsFeature(f: string): boolean } }).featurePolicy)
      : undefined;
    const allowed = policy ? policy.allowsFeature('midi') : true;
    if (embedded && (!allowed || this.state === 'denied')) return 'This page is running inside another site (like a preview on claude.ai), and that site doesn\'t allow MIDI. Open Playfield in its own tab or the desktop app to use a controller.';
    if (this.state === 'denied') return 'The browser refused MIDI access. Allow MIDI for this site (the icon left of the address bar), then press Connect.';
    if (this.busyNames.length) return `Couldn't open ${this.busyNames.join(', ')}: another app is probably using it (on Windows only one app can hold a MIDI device). Turn it off in Ableton's MIDI preferences or close the app, then press Connect.`;
    return null;
  }

  /**
   * Safe to call repeatedly. A refusal sticks (asking again on every render
   * would nag), except when `retry` is set: a click on Connect or Learn asks
   * again, and re-opens devices that another app was holding.
   */
  async connect(opts: { retry?: boolean } = {}): Promise<MidiBackendStatus> {
    if (this.state === 'unsupported') return 'unsupported';
    if (this.access) {
      if (opts.retry && this.busyNames.length) this.bindInputs();
      return 'ready';
    }
    if (this.state === 'requesting') return this.pending ?? 'requesting';
    if (this.state === 'denied' && !opts.retry) return 'denied';
    this.state = 'requesting';
    this.sink.devices(this.inputNames);
    this.watchPermission();
    this.pending = (async () => {
      try {
        const access = await navigator.requestMIDIAccess({ sysex: false });
        this.access = access;
        this.state = 'ready';
        access.addEventListener('statechange', () => this.bindInputs());
        this.bindInputs();
      } catch (e) {
        console.warn('[midi] The browser refused MIDI access:', e);
        this.state = 'denied';
        this.sink.devices([]);
      }
      this.pending = null;
      return this.state;
    })();
    return this.pending;
  }

  /** Allowing MIDI in the site settings after a refusal connects without a reload. */
  private watchPermission(): void {
    if (this.permissionWatched || typeof navigator === 'undefined' || !navigator.permissions?.query) return;
    this.permissionWatched = true;
    navigator.permissions.query({ name: 'midi' as PermissionName }).then(p => {
      p.addEventListener('change', () => {
        if (p.state === 'granted' && !this.access) void this.connect({ retry: true });
      });
    }).catch(() => { /* no MIDI permission in this browser's Permissions API */ });
  }

  private bindInputs(): void {
    if (!this.access) return;
    const names: string[] = [];
    const busy: string[] = [];
    const opening: Promise<unknown>[] = [];
    this.access.inputs.forEach(input => {
      // Assigning the handler is idempotent; statechange fires on every plug/unplug.
      input.onmidimessage = this.onMidiMessage;
      if (input.state !== 'connected') return;
      const name = input.name ?? input.id;
      names.push(name);
      // The handler opens the port implicitly, but silently: opening it ourselves says when that fails.
      if (input.connection !== 'open' && typeof input.open === 'function') {
        opening.push(input.open().then(() => {}, err => {
          console.warn(`[midi] Couldn't open "${name}" (is another app using it?):`, err);
          busy.push(name);
        }));
      }
    });
    this.inputNames = names;
    this.busyNames = [];
    console.info(names.length ? `[midi] Listening to ${names.join(', ')}` : '[midi] Access granted, but no MIDI inputs are connected');
    this.sink.devices(names);
    if (opening.length) void Promise.all(opening).then(() => {
      if (!busy.length) return;
      this.busyNames = busy;
      this.sink.devices(names);
    });
  }
}
