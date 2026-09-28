/**
 * midiMonitor.ts — a log of every raw MIDI message the app receives, per
 * device, for finding out why a controller isn't doing what it should ("what
 * does this pad send?", "is the Akai getting through at all?").
 *
 * The MIDI engine pushes every channel message it handles (hardware, the
 * stand-in, a MIDI file, `handleBytes` from the console) and the transports
 * push what the engine doesn't model (sysex, clock, program change). The
 * Monitor view (components/play/MidiMonitor.tsx) shows the newest lines and
 * copies them as text. A ring buffer, no React.
 */

export const MONITOR_MAX = 500;

export interface MidiMonitorEntry {
  seq: number;
  /** Date.now() when it arrived. */
  at: number;
  /** The input's name ('' for the keyboard stand-in, a MIDI file or a scripted message). */
  device: string;
  /** The input's id in the transport ('' when unknown). */
  id: string;
  /** The message, or the first bytes of a long sysex. */
  bytes: number[];
  /** The whole message's length (more than `bytes.length` for a trimmed sysex). */
  len: number;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (n: number) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

/** The usual names for CCs (MIDI 1.0 and General MIDI); others are just their number. */
export const CC_NAMES: Record<number, string> = {
  0: 'Bank select', 1: 'Mod wheel', 2: 'Breath', 4: 'Foot', 5: 'Portamento time', 6: 'Data entry', 7: 'Volume', 8: 'Balance',
  10: 'Pan', 11: 'Expression', 12: 'Effect 1', 13: 'Effect 2', 16: 'General 1', 17: 'General 2', 18: 'General 3', 19: 'General 4',
  32: 'Bank select LSB', 33: 'Mod wheel LSB', 38: 'Data entry LSB',
  64: 'Sustain', 65: 'Portamento', 66: 'Sostenuto', 67: 'Soft pedal', 68: 'Legato', 69: 'Hold 2',
  70: 'Sound variation', 71: 'Resonance', 72: 'Release', 73: 'Attack', 74: 'Cutoff', 75: 'Decay', 76: 'Vibrato rate', 77: 'Vibrato depth', 78: 'Vibrato delay',
  84: 'Portamento control', 91: 'Reverb', 92: 'Tremolo', 93: 'Chorus', 94: 'Detune', 95: 'Phaser',
  96: 'Data +', 97: 'Data −', 98: 'NRPN LSB', 99: 'NRPN MSB', 100: 'RPN LSB', 101: 'RPN MSB',
  120: 'All sound off', 121: 'Reset controllers', 122: 'Local control', 123: 'All notes off', 124: 'Omni off', 125: 'Omni on', 126: 'Mono', 127: 'Poly',
};

const SYSEX_MAKERS: Record<number, string> = {
  0x01: 'Sequential', 0x04: 'Moog', 0x07: 'Kurzweil', 0x0f: 'Ensoniq', 0x10: 'Oberheim', 0x18: 'E-mu', 0x1c: 'Eventide', 0x20: 'Passac',
  0x21: 'Hohner', 0x2f: 'Elka', 0x33: 'Clavia', 0x3e: 'Waldorf', 0x40: 'Kawai', 0x41: 'Roland', 0x42: 'Korg', 0x43: 'Yamaha', 0x44: 'Casio',
  0x47: 'Akai', 0x7d: 'Non-commercial', 0x7e: 'Universal (non-realtime)', 0x7f: 'Universal (realtime)',
};

const REALTIME: Record<number, string> = {
  0xf8: 'Clock', 0xf9: 'Tick', 0xfa: 'Start', 0xfb: 'Continue', 0xfc: 'Stop', 0xfe: 'Active sensing', 0xff: 'Reset',
};

export interface MidiDecoded {
  /** 'note' | 'cc' | 'bend' | 'pressure' | 'program' | 'sysex' | 'system' | 'other' */
  kind: string;
  /** 1..16 for a channel message, else null. */
  channel: number | null;
  /** "Note on C4 (60) vel 100", "CC 1 Mod wheel = 64", "SysEx Akai (12 bytes)". */
  text: string;
}

/** What a message means, in words. */
export function describeMidiBytes(bytes: readonly number[], len = bytes.length): MidiDecoded {
  const s = bytes[0] ?? 0, d1 = bytes[1] ?? 0, d2 = bytes[2] ?? 0;
  if (s >= 0x80 && s < 0xf0) {
    const channel = (s & 0x0f) + 1;
    switch (s & 0xf0) {
      case 0x90: return d2 > 0
        ? { kind: 'note', channel, text: `Note on ${noteName(d1)} (${d1}) vel ${d2}` }
        : { kind: 'note', channel, text: `Note off ${noteName(d1)} (${d1}) (vel 0)` };
      case 0x80: return { kind: 'note', channel, text: `Note off ${noteName(d1)} (${d1})` };
      case 0xa0: return { kind: 'pressure', channel, text: `Poly pressure ${noteName(d1)} (${d1}) = ${d2}` };
      case 0xb0: return { kind: 'cc', channel, text: `CC ${d1}${CC_NAMES[d1] ? ` ${CC_NAMES[d1]}` : ''} = ${d2}` };
      case 0xc0: return { kind: 'program', channel, text: `Program ${d1}` };
      case 0xd0: return { kind: 'pressure', channel, text: `Channel pressure = ${d1}` };
      case 0xe0: return { kind: 'bend', channel, text: `Pitch bend ${((d2 << 7) | d1) - 8192}` };
    }
  }
  if (s === 0xf0) {
    const maker = SYSEX_MAKERS[d1] ?? (d1 === 0 ? `id 00 ${hex(bytes[2] ?? 0)} ${hex(bytes[3] ?? 0)}` : `id ${hex(d1)}`);
    return { kind: 'sysex', channel: null, text: `SysEx ${maker} (${len} bytes${len > bytes.length ? ', first ' + bytes.length + ' shown' : ''})` };
  }
  if (REALTIME[s]) return { kind: 'system', channel: null, text: REALTIME[s] };
  if (s === 0xf1) return { kind: 'system', channel: null, text: `MTC quarter frame ${d1}` };
  if (s === 0xf2) return { kind: 'system', channel: null, text: `Song position ${(d2 << 7) | d1}` };
  if (s === 0xf3) return { kind: 'system', channel: null, text: `Song select ${d1}` };
  if (s === 0xf6) return { kind: 'system', channel: null, text: 'Tune request' };
  if (s === 0xf7) return { kind: 'system', channel: null, text: 'End of sysex' };
  return { kind: 'other', channel: null, text: `Unknown status ${hex(s)}` };
}

export const hex = (b: number) => b.toString(16).toUpperCase().padStart(2, '0');

/** "12:03:04.123  MPK mini 3  90 3C 64  Note on C4 (60) vel 100 · ch 1" */
export function formatMonitorLine(e: MidiMonitorEntry): string {
  const d = new Date(e.at);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
  const dec = describeMidiBytes(e.bytes, e.len);
  const raw = e.bytes.map(hex).join(' ') + (e.len > e.bytes.length ? ' …' : '');
  return `${time}  ${e.device || '(no device)'}  ${raw}  ${dec.text}${dec.channel ? ` · ch ${dec.channel}` : ''}`;
}

/** How many bytes a message with status `s` has (0 for sysex: it runs to 0xF7). */
export function midiMessageLength(s: number): number {
  if (s >= 0xc0 && s <= 0xdf) return 2;
  if (s >= 0x80 && s <= 0xef) return 3;
  if (s === 0xf1 || s === 0xf3) return 2;
  if (s === 0xf2) return 3;
  if (s === 0xf0) return 0;
  return 1;
}

export class MidiMonitor {
  private entries: MidiMonitorEntry[] = [];
  private seq = 0;
  private paused = false;
  /** Bumps on every change; the view polls it instead of re-rendering per message. */
  private ver = 0;
  private listeners = new Set<() => void>();
  /** Per device: how many messages, and the last one's time. */
  private counts = new Map<string, { count: number; at: number }>();

  push(bytes: readonly number[], device: string, id = '', len = bytes.length): void {
    const key = device || id;
    const c = this.counts.get(key);
    const at = Date.now();
    if (c) { c.count++; c.at = at; } else this.counts.set(key, { count: 1, at });
    if (this.paused) return;
    this.entries.push({ seq: ++this.seq, at, device, id, bytes: [...bytes], len });
    if (this.entries.length > MONITOR_MAX * 2) this.entries = this.entries.slice(-MONITOR_MAX);
    this.changed();
  }

  /** The newest entries (oldest first), all devices or one by name. */
  list(device?: string, max = MONITOR_MAX): MidiMonitorEntry[] {
    const all = device === undefined ? this.entries : this.entries.filter(e => e.device === device);
    return all.length > max ? all.slice(-max) : all;
  }

  /** Messages seen per device (even while paused), for the sources table. */
  seen(device: string): { count: number; at: number } | null {
    return this.counts.get(device) ?? null;
  }

  isPaused(): boolean { return this.paused; }
  setPaused(on: boolean): void { if (on !== this.paused) { this.paused = on; this.changed(); } }
  clear(): void { this.entries = []; this.changed(); }
  version(): number { return this.ver; }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  }

  /** The log as text, for the clipboard. */
  text(device?: string, max = MONITOR_MAX): string {
    return this.list(device, max).map(formatMonitorLine).join('\n');
  }

  private changed(): void {
    this.ver++;
    for (const l of this.listeners) l();
  }
}

export const midiMonitor = new MidiMonitor();
