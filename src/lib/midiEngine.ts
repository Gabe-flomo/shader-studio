/**
 * midiEngine.ts — module singleton that turns MIDI messages into per-node
 * float channels for the input bus. No React, no Zustand (mirrors audioEngine).
 *
 * Message sources ("backends") all funnel into `handleMessage`:
 *   - Web MIDI (Chrome, Edge, Windows WebView2)
 *   - the computer keyboard stand-in (two octaves on the QWERTY rows), for
 *     Safari, Firefox, phones, and testing without hardware
 *   - later: a Tauri plugin on macOS (WKWebView has no Web MIDI)
 *
 * State is kept per MIDI channel (1–16) plus an "omni" merge of all of them,
 * so a node set to "All" and a node set to channel 3 read different things.
 * Per node the engine smooths each channel toward its target with a simple
 * exponential filter (time constant = the node's `smooth_ms`).
 */

import type { InputSource, InputWriter } from './inputBus';
import { midiCcList, midiCcKey, liveChannelKey } from './midiOutputs';

// ─── Message model ────────────────────────────────────────────────────────────

export type MidiEvent =
  | { kind: 'noteOn';  channel: number; note: number; velocity: number }
  | { kind: 'noteOff'; channel: number; note: number }
  | { kind: 'cc';      channel: number; cc: number; value: number }
  | { kind: 'bend';    channel: number; value: number }   // -1..1
  | { kind: 'devices'; inputs: string[] };

export type MidiListener = (e: MidiEvent) => void;

export type MidiBackendStatus = 'unsupported' | 'idle' | 'requesting' | 'ready' | 'denied';

const OMNI = 0;

class ChannelState {
  lastNote = 60;      // MIDI note number of the most recent note-on
  lastVelocity = 0;   // 0..127 of the most recent note-on
  held = new Set<number>();
  bend = 0;           // -1..1
  cc = new Float32Array(128); // 0..127 raw
}

interface NodeState {
  channel: number;    // 0 = omni, 1..16
  ccs: number[];
  smoothMs: number;
  /** channel key → smoothed value */
  smoothed: Map<string, number>;
}

// ─── Keyboard stand-in layout ───────────────────────────────────────────────
// Ableton-style: home row = white keys from C, row above = black keys.
// Semitone offsets from the base octave's C.
const KEY_NOTES: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7,
  KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15,
  Semicolon: 16, Quote: 17,
};
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiNoteName(n: number): string {
  const clamped = Math.max(0, Math.min(127, Math.round(n)));
  return `${NOTE_NAMES[clamped % 12]}${Math.floor(clamped / 12) - 1}`;
}

function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  const tag = node?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!node?.isContentEditable;
}

// ─── Engine ───────────────────────────────────────────────────────────────────

class MidiEngine implements InputSource {
  private channels: ChannelState[] = Array.from({ length: 17 }, () => new ChannelState());
  private nodes = new Map<string, NodeState>();
  private listeners = new Set<MidiListener>();

  // Web MIDI backend
  private access: MIDIAccess | null = null;
  private webMidiStatus: MidiBackendStatus = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator ? 'idle' : 'unsupported';
  private inputNames: string[] = [];
  private onMidiMessage = (e: Event) => {
    const data = (e as MIDIMessageEvent).data;
    if (data && data.length >= 1) this.handleBytes(data[0], data[1] ?? 0, data[2] ?? 0);
  };

  // Keyboard stand-in backend
  private keyboardEnabled = false;
  private keyboardOctave = 4;    // base octave: KeyA = C4 (60)
  private keyboardVelocity = 100;
  private keyboardHeld = new Map<string, number>(); // code → note number
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
    // While the stand-in is on, these keys are a piano: swallow them before the
    // app's own shortcuts (registered in the bubble phase on window) see them.
    const consume = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.code === 'KeyZ') { this.keyboardOctave = Math.max(0, this.keyboardOctave - 1); consume(); return; }
    if (e.code === 'KeyX') { this.keyboardOctave = Math.min(8, this.keyboardOctave + 1); consume(); return; }
    if (e.code === 'KeyC') { this.keyboardVelocity = Math.max(1, this.keyboardVelocity - 16); consume(); return; }
    if (e.code === 'KeyV') { this.keyboardVelocity = Math.min(127, this.keyboardVelocity + 16); consume(); return; }
    const offset = KEY_NOTES[e.code];
    if (offset === undefined) return;
    consume();
    if (this.keyboardHeld.has(e.code)) return;
    const note = Math.min(127, (this.keyboardOctave + 1) * 12 + offset);
    this.keyboardHeld.set(e.code, note);
    this.handleMessage({ kind: 'noteOn', channel: 1, note, velocity: this.keyboardVelocity });
  };
  private onKeyUp = (e: KeyboardEvent) => {
    const note = this.keyboardHeld.get(e.code);
    if (note === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    this.keyboardHeld.delete(e.code);
    this.handleMessage({ kind: 'noteOff', channel: 1, note });
  };
  private onBlur = () => { this.releaseKeyboardNotes(); };

  // ── Node registration ─────────────────────────────────────────────────────

  /** Called by the node card whenever the node's params change. */
  updateNode(nodeId: string, params: Record<string, unknown> | undefined): void {
    const rawCh = params?.channel;
    const channel = typeof rawCh === 'number' ? rawCh : typeof rawCh === 'string' ? parseInt(rawCh, 10) || 0 : 0;
    const smoothMs = typeof params?.smooth_ms === 'number' ? Math.max(0, params.smooth_ms) : 0;
    const ccs = midiCcList(params);
    const existing = this.nodes.get(nodeId);
    if (existing) {
      existing.channel = Math.max(0, Math.min(16, channel));
      existing.smoothMs = smoothMs;
      existing.ccs = ccs;
    } else {
      this.nodes.set(nodeId, { channel: Math.max(0, Math.min(16, channel)), smoothMs, ccs, smoothed: new Map() });
    }
  }

  removeNode(nodeId: string): void {
    this.nodes.delete(nodeId);
  }

  hasNodes(): boolean {
    return this.nodes.size > 0;
  }

  // ── Events for the UI (activity readouts, learn later) ───────────────────

  subscribe(listener: MidiListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(e: MidiEvent): void {
    for (const l of this.listeners) l(e);
  }

  // ── Message ingestion (all backends end up here) ─────────────────────────

  /** Raw 3-byte message, as delivered by Web MIDI or a native bridge. */
  handleBytes(status: number, d1: number, d2: number): void {
    const type = status & 0xf0;
    const channel = (status & 0x0f) + 1;
    switch (type) {
      case 0x90:
        if (d2 > 0) this.handleMessage({ kind: 'noteOn', channel, note: d1, velocity: d2 });
        else this.handleMessage({ kind: 'noteOff', channel, note: d1 });
        break;
      case 0x80:
        this.handleMessage({ kind: 'noteOff', channel, note: d1 });
        break;
      case 0xb0:
        this.handleMessage({ kind: 'cc', channel, cc: d1, value: d2 });
        break;
      case 0xe0: {
        const raw = ((d2 << 7) | d1) - 8192; // -8192..8191
        this.handleMessage({ kind: 'bend', channel, value: Math.max(-1, Math.min(1, raw / 8192)) });
        break;
      }
      default:
        break; // aftertouch, program change, clock… not modelled yet
    }
  }

  handleMessage(e: MidiEvent): void {
    if (e.kind === 'devices') { this.emit(e); return; }
    const targets = [this.channels[OMNI], this.channels[Math.max(1, Math.min(16, e.channel))]];
    for (const ch of targets) {
      switch (e.kind) {
        case 'noteOn':
          ch.lastNote = e.note;
          ch.lastVelocity = e.velocity;
          ch.held.add(e.note);
          break;
        case 'noteOff':
          ch.held.delete(e.note);
          break;
        case 'cc':
          ch.cc[e.cc & 127] = e.value;
          break;
        case 'bend':
          ch.bend = e.value;
          break;
      }
    }
    this.emit(e);
  }

  /** Current raw state for a channel (0 = omni). Read by UI, not per frame. */
  channelState(channel: number): { lastNote: number; lastVelocity: number; heldCount: number; bend: number; cc: Float32Array } {
    const ch = this.channels[Math.max(0, Math.min(16, channel))];
    return { lastNote: ch.lastNote, lastVelocity: ch.lastVelocity, heldCount: ch.held.size, bend: ch.bend, cc: ch.cc };
  }

  // ── Per-frame output (InputSource) ───────────────────────────────────────

  tickInputs(dt: number, _time: number, write: InputWriter): void {
    for (const [nodeId, st] of this.nodes) {
      const ch = this.channels[st.channel];
      // Exponential smoothing: alpha = 1 - exp(-dt / tau). smoothMs 0 → snap.
      const alpha = st.smoothMs > 0 ? 1 - Math.exp(-(dt * 1000) / st.smoothMs) : 1;
      this.write(write, st, nodeId, 'note', ch.lastNote / 127, alpha);
      this.write(write, st, nodeId, 'velocity', ch.lastVelocity / 127, alpha);
      this.write(write, st, nodeId, 'gate', ch.held.size > 0 ? 1 : 0, alpha);
      this.write(write, st, nodeId, 'bend', ch.bend, alpha);
      for (const cc of st.ccs) this.write(write, st, nodeId, midiCcKey(cc), ch.cc[cc] / 127, alpha);
    }
  }

  private write(write: InputWriter, st: NodeState, nodeId: string, outputKey: string, target: number, alpha: number): void {
    const key = liveChannelKey(nodeId, outputKey);
    let v: number;
    if (alpha >= 1) {
      v = target;
    } else {
      const prev = st.smoothed.get(key);
      v = prev === undefined ? target : prev + (target - prev) * alpha;
      // Settle exactly so a held value stops producing sub-epsilon churn.
      if (Math.abs(v - target) < 1e-4) v = target;
    }
    st.smoothed.set(key, v);
    write(key, v);
  }

  // ── Web MIDI backend ─────────────────────────────────────────────────────

  webMidi(): { status: MidiBackendStatus; inputs: string[] } {
    return { status: this.webMidiStatus, inputs: this.inputNames };
  }

  /** Ask the browser for MIDI access and listen to every input. Safe to call repeatedly. */
  async connectWebMidi(): Promise<MidiBackendStatus> {
    if (this.webMidiStatus === 'unsupported') return 'unsupported';
    if (this.access) return 'ready';
    if (this.webMidiStatus === 'requesting') return 'requesting';
    this.webMidiStatus = 'requesting';
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      this.access = access;
      this.webMidiStatus = 'ready';
      access.addEventListener('statechange', () => this.bindInputs());
      this.bindInputs();
    } catch (e) {
      console.warn('[midiEngine] Web MIDI access refused', e);
      this.webMidiStatus = 'denied';
    }
    return this.webMidiStatus;
  }

  private bindInputs(): void {
    if (!this.access) return;
    const names: string[] = [];
    this.access.inputs.forEach(input => {
      // Assigning the handler is idempotent; statechange fires on every plug/unplug.
      input.onmidimessage = this.onMidiMessage;
      if (input.state === 'connected') names.push(input.name ?? input.id);
    });
    this.inputNames = names;
    this.emit({ kind: 'devices', inputs: names });
  }

  // ── Keyboard stand-in backend ────────────────────────────────────────────

  keyboard(): { enabled: boolean; octave: number; velocity: number } {
    return { enabled: this.keyboardEnabled, octave: this.keyboardOctave, velocity: this.keyboardVelocity };
  }

  setKeyboardEnabled(on: boolean): void {
    if (on === this.keyboardEnabled || typeof window === 'undefined') return;
    this.keyboardEnabled = on;
    if (on) {
      window.addEventListener('keydown', this.onKeyDown, true);
      window.addEventListener('keyup', this.onKeyUp, true);
      window.addEventListener('blur', this.onBlur);
    } else {
      window.removeEventListener('keydown', this.onKeyDown, true);
      window.removeEventListener('keyup', this.onKeyUp, true);
      window.removeEventListener('blur', this.onBlur);
      this.releaseKeyboardNotes();
    }
  }

  private releaseKeyboardNotes(): void {
    for (const [, note] of this.keyboardHeld) this.handleMessage({ kind: 'noteOff', channel: 1, note });
    this.keyboardHeld.clear();
  }
}

export const midiEngine = new MidiEngine();
