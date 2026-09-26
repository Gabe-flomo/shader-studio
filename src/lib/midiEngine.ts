/**
 * midiEngine.ts — module singleton that turns MIDI messages into per-node
 * float channels for the input bus. No React, no Zustand (mirrors audioEngine).
 *
 * Message sources ("backends") all funnel into `handleMessage`:
 *   - Web MIDI (Chrome, Edge, Windows WebView2)
 *   - the computer keyboard stand-in (two octaves on the QWERTY rows), for
 *     Safari, Firefox, phones, and testing without hardware
 *   - a MIDI file (the Play record's midiFile), played on the graph clock, so
 *     a performance can be recorded to video in sync without a DAW attached
 *   - later: a Tauri plugin on macOS (WKWebView has no Web MIDI)
 *
 * State is kept per MIDI channel (1–16) plus an "omni" merge of all of them,
 * so a node set to "All" and a node set to channel 3 read different things.
 * Per node the engine smooths each channel toward its target with a simple
 * exponential filter (time constant = the node's `smooth_ms`).
 */

import { inputBus, type InputSource, type InputWriter } from './inputBus';
import { midiCcList, midiCcKey, liveChannelKey } from './midiOutputs';
import { base64ToBytes, eventIndexAt, parseMidiFile, type MidiFileData } from './midiFile';
import type { PlayMidiFile } from '../types/play';

/** A seek further ahead than this skips to the new spot instead of firing everything in between. */
const FILE_SKIP_S = 2;

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
  // "Has this ever been received?" — a Play mapping only takes a param over
  // once its knob has actually moved, so an untouched CC doesn't pin a slider.
  seenNote = false;
  seenBend = false;
  seenCc = new Uint8Array(128);
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

export class MidiEngine implements InputSource {
  private channels: ChannelState[] = Array.from({ length: 17 }, () => new ChannelState());
  private nodes = new Map<string, NodeState>();
  private listeners = new Set<MidiListener>();

  // Web MIDI backend
  private access: MIDIAccess | null = null;
  private webMidiStatus: MidiBackendStatus = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator ? 'idle' : 'unsupported';
  private inputNames: string[] = [];
  /** Inputs the browser lists but couldn't open (on Windows: another app, like Ableton, has it). */
  private busyNames: string[] = [];
  private lastMessage: { text: string; at: number } | null = null;
  private permissionWatched = false;
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

  // MIDI file backend
  private file: { src: PlayMidiFile; data: MidiFileData } | null = null;
  private fileError: string | null = null;
  private fileIdx = 0;
  private fileLastT = Number.NEGATIVE_INFINITY;
  private fileLap = 0;
  private fileHeld = new Set<number>(); // (channel - 1) * 128 + note

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
    // A note-off says less than the note-on before it: keep that one on show.
    if (e.kind !== 'noteOff') this.lastMessage = { text: describeMidiEvent(e), at: Date.now() };
    const targets = [this.channels[OMNI], this.channels[Math.max(1, Math.min(16, e.channel))]];
    for (const ch of targets) {
      switch (e.kind) {
        case 'noteOn':
          ch.lastNote = e.note;
          ch.lastVelocity = e.velocity;
          ch.held.add(e.note);
          ch.seenNote = true;
          break;
        case 'noteOff':
          ch.held.delete(e.note);
          break;
        case 'cc':
          ch.cc[e.cc & 127] = e.value;
          ch.seenCc[e.cc & 127] = 1;
          break;
        case 'bend':
          ch.bend = e.value;
          ch.seenBend = true;
          break;
      }
    }
    inputBus.wake();
    this.emit(e);
  }

  /** Current raw state for a channel (0 = omni). Read by UI, not per frame. */
  channelState(channel: number): { lastNote: number; lastVelocity: number; heldCount: number; bend: number; cc: Float32Array; seenNote: boolean; seenBend: boolean; seenCc: Uint8Array } {
    const ch = this.channels[Math.max(0, Math.min(16, channel))];
    return { lastNote: ch.lastNote, lastVelocity: ch.lastVelocity, heldCount: ch.held.size, bend: ch.bend, cc: ch.cc, seenNote: ch.seenNote, seenBend: ch.seenBend, seenCc: ch.seenCc };
  }

  // ── Per-frame output (InputSource) ───────────────────────────────────────

  /** A loaded file plays whether or not a MIDI node is in the graph (mappings read it too). */
  wantsTick(): boolean {
    return this.file !== null;
  }

  tickInputs(dt: number, time: number, write: InputWriter): void {
    this.tickFile(time);
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

  webMidi(): { status: MidiBackendStatus; inputs: string[]; busy: string[] } {
    return { status: this.webMidiStatus, inputs: this.inputNames, busy: this.busyNames };
  }

  /** The newest message from any backend ("CC 21 = 64 · ch 1"), and when it came. */
  lastActivity(): { text: string; at: number } | null {
    return this.lastMessage;
  }

  /**
   * Why MIDI can't work on this page, in words, or null. The usual case is a
   * page embedded in another site (an iframe) that wasn't given MIDI: the
   * browser refuses without asking, so nothing shows up.
   */
  blockReason(): string | null {
    if (this.webMidiStatus === 'unsupported') return 'This browser has no Web MIDI (Chrome, Edge and Opera have it; Safari does not). The keyboard stand-in on a MIDI Input node still works.';
    const embedded = typeof window !== 'undefined' && window.self !== window.top;
    const policy = typeof document !== 'undefined'
      ? ((document as unknown as { permissionsPolicy?: { allowsFeature(f: string): boolean }; featurePolicy?: { allowsFeature(f: string): boolean } }).permissionsPolicy
        ?? (document as unknown as { featurePolicy?: { allowsFeature(f: string): boolean } }).featurePolicy)
      : undefined;
    const allowed = policy ? policy.allowsFeature('midi') : true;
    if (embedded && (!allowed || this.webMidiStatus === 'denied')) return 'This page is running inside another site (like a preview on claude.ai), and that site doesn\'t allow MIDI. Open Playfield in its own tab or the desktop app to use a controller.';
    if (this.webMidiStatus === 'denied') return 'The browser refused MIDI access. Allow MIDI for this site (the icon left of the address bar), then press Connect.';
    if (this.busyNames.length) return `Couldn't open ${this.busyNames.join(', ')}: another app is probably using it (on Windows only one app can hold a MIDI device). Turn it off in Ableton's MIDI preferences or close the app, then press Connect.`;
    return null;
  }

  /**
   * Ask the browser for MIDI access and listen to every input. Safe to call
   * repeatedly. A refusal sticks (asking again on every render would nag),
   * except when `retry` is set: a click on Connect or Learn asks again, and
   * re-opens devices that another app was holding.
   */
  async connectWebMidi(opts: { retry?: boolean } = {}): Promise<MidiBackendStatus> {
    if (this.webMidiStatus === 'unsupported') return 'unsupported';
    if (this.access) {
      if (opts.retry && this.busyNames.length) this.bindInputs();
      return 'ready';
    }
    if (this.webMidiStatus === 'requesting') return this.pending ?? 'requesting';
    if (this.webMidiStatus === 'denied' && !opts.retry) return 'denied';
    this.webMidiStatus = 'requesting';
    this.emit({ kind: 'devices', inputs: this.inputNames });
    this.watchPermission();
    this.pending = (async () => {
      try {
        const access = await navigator.requestMIDIAccess({ sysex: false });
        this.access = access;
        this.webMidiStatus = 'ready';
        access.addEventListener('statechange', () => this.bindInputs());
        this.bindInputs();
      } catch (e) {
        console.warn('[midi] The browser refused MIDI access:', e);
        this.webMidiStatus = 'denied';
        this.emit({ kind: 'devices', inputs: [] });
      }
      this.pending = null;
      return this.webMidiStatus;
    })();
    return this.pending;
  }
  private pending: Promise<MidiBackendStatus> | null = null;

  /** Allowing MIDI in the site settings after a refusal connects without a reload. */
  private watchPermission(): void {
    if (this.permissionWatched || typeof navigator === 'undefined' || !navigator.permissions?.query) return;
    this.permissionWatched = true;
    navigator.permissions.query({ name: 'midi' as PermissionName }).then(p => {
      p.addEventListener('change', () => {
        if (p.state === 'granted' && !this.access) void this.connectWebMidi({ retry: true });
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
    this.emit({ kind: 'devices', inputs: names });
    if (opening.length) void Promise.all(opening).then(() => {
      if (!busy.length) return;
      this.busyNames = busy;
      this.emit({ kind: 'devices', inputs: names });
    });
  }

  // ── MIDI file backend ────────────────────────────────────────────────────

  /**
   * Load (or clear) the record's MIDI file. The same file object is a no-op;
   * a new one is parsed and starts from the clock's current time.
   */
  setFile(src: PlayMidiFile | undefined): void {
    if (src === this.file?.src || (!src && !this.file && !this.fileError)) return;
    if (this.file && src && src.data === this.file.src.data) {
      // Only the loop or the offset changed: keep the parse, find the spot again.
      this.file = { src, data: this.file.data };
      this.seekFile();
      return;
    }
    this.releaseFileNotes();
    this.file = null;
    this.fileError = null;
    if (src) {
      try {
        this.file = { src, data: parseMidiFile(base64ToBytes(src.data)) };
      } catch (e) {
        this.fileError = e instanceof Error ? e.message : 'Couldn’t read that MIDI file';
      }
    }
    this.seekFile();
    inputBus.wake();
  }

  /** The loaded file: its length, how many notes, which channels; or why it couldn't be read. */
  fileInfo(): { duration: number; notes: number; channels: number[] } | { error: string } | null {
    if (this.fileError) return { error: this.fileError };
    return this.file ? { duration: this.file.data.duration, notes: this.file.data.notes, channels: this.file.data.channels } : null;
  }

  hasFile(): boolean {
    return this.file !== null;
  }

  /** Seconds into the file at the last frame (negative before it starts), or null before it has played. */
  filePosition(): number | null {
    return this.file && Number.isFinite(this.fileLastT) ? this.fileLastT : null;
  }

  /** Where the file is at graph time `time` (seconds into the file; negative before it starts). */
  fileTimeAt(time: number): number {
    const f = this.file;
    if (!f) return 0;
    const t = time - f.src.offset;
    const dur = f.data.duration;
    return f.src.loop && dur > 0 && t >= 0 ? t % dur : t;
  }

  private seekFile(): void {
    this.fileIdx = 0;
    this.fileLastT = Number.NEGATIVE_INFINITY;
    this.fileLap = 0;
  }

  private tickFile(time: number): void {
    const f = this.file;
    if (!f) return;
    const ev = f.data.events;
    const t = this.fileTimeAt(time);
    // The loop coming round by itself (not a seek): play out to the end, then carry on from 0.
    const raw = time - f.src.offset, dur = f.data.duration;
    const lap = f.src.loop && dur > 0 && raw >= 0 ? Math.floor(raw / dur) : 0;
    if (lap === this.fileLap + 1 && t < this.fileLastT && this.fileLastT - t > dur - FILE_SKIP_S) {
      this.playFileTo(dur);
      this.fileIdx = 0;
      this.fileLastT = 0;
    }
    this.fileLap = lap;
    // Back in time (a reset, a seek, the loop coming round) or far ahead: release what's held and
    // carry on from the new spot, without replaying what was skipped.
    // Landing near the start (a reset, the loop wrapping) plays from 0, so a downbeat on 0 isn't lost.
    if (t < this.fileLastT || t - this.fileLastT > FILE_SKIP_S) {
      this.releaseFileNotes();
      this.fileIdx = eventIndexAt(ev, t <= 0.25 ? 0 : t);
    }
    this.playFileTo(t);
    this.fileLastT = t;
  }

  /** Send every file event up to file time `t`, keeping track of held notes. */
  private playFileTo(t: number): void {
    const ev = this.file?.data.events;
    if (!ev) return;
    while (this.fileIdx < ev.length && ev[this.fileIdx].t <= t) {
      const e = ev[this.fileIdx++];
      const type = e.status & 0xf0, key = (e.status & 0x0f) * 128 + e.d1;
      if (type === 0x90 && e.d2 > 0) this.fileHeld.add(key);
      else if (type === 0x80 || type === 0x90) this.fileHeld.delete(key);
      this.handleBytes(e.status, e.d1, e.d2);
    }
  }

  private releaseFileNotes(): void {
    for (const key of this.fileHeld) this.handleMessage({ kind: 'noteOff', channel: Math.floor(key / 128) + 1, note: key % 128 });
    this.fileHeld.clear();
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

/** "C4 · vel 100", "CC 21 = 64", "bend 0.25", with the channel. */
export function describeMidiEvent(e: MidiEvent): string {
  switch (e.kind) {
    case 'noteOn': return `${midiNoteName(e.note)} (note ${e.note}) · vel ${e.velocity} · ch ${e.channel}`;
    case 'noteOff': return `${midiNoteName(e.note)} off · ch ${e.channel}`;
    case 'cc': return `CC ${e.cc} = ${e.value} · ch ${e.channel}`;
    case 'bend': return `bend ${e.value.toFixed(2)} · ch ${e.channel}`;
    case 'devices': return 'devices changed';
  }
}

export const midiEngine = new MidiEngine();
// The engine is a bus source for the life of the app: the render loop asks the
// bus for values every frame, and this is what makes a MIDI node's outputs move.
inputBus.addSource(midiEngine);
