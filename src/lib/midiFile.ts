/**
 * midiFile.ts — read a Standard MIDI File (.mid) into timed messages.
 *
 * Formats 0 and 1 (type 2, independent sequences, is read as if they played
 * together). Every track's tempo changes form one tempo map, so a format-1
 * file whose tempo track is separate still lands its notes at the right
 * seconds. Running status, SysEx and meta events are handled; only channel
 * messages the engine models are kept (note on/off, CC, pitch bend).
 *
 * The result is plain data, sorted by time, that midiEngine plays on the
 * graph clock as if a controller sent it.
 */

export interface MidiFileEvent {
  /** Seconds from the start of the file. */
  t: number;
  status: number;
  d1: number;
  d2: number;
}

export interface MidiFileData {
  events: MidiFileEvent[];
  /** Seconds until the last event (a trailing end-of-track included). */
  duration: number;
  notes: number;
  /** Channels (1–16) that play anything. */
  channels: number[];
}

interface RawEvent { tick: number; order: number; status: number; d1: number; d2: number; tempo?: number }

class Reader {
  pos = 0;
  private b: Uint8Array;
  constructor(b: Uint8Array) { this.b = b; }
  get left(): number { return this.b.length - this.pos; }
  u8(): number { if (this.pos >= this.b.length) throw new Error('The file ends early'); return this.b[this.pos++]; }
  u16(): number { return (this.u8() << 8) | this.u8(); }
  u32(): number { return ((this.u8() << 24) >>> 0) + (this.u8() << 16) + (this.u8() << 8) + this.u8(); }
  str(n: number): string { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8()); return s; }
  vlq(): number {
    let v = 0;
    for (let i = 0; i < 4; i++) { const c = this.u8(); v = (v << 7) | (c & 0x7f); if (!(c & 0x80)) return v; }
    throw new Error('A bad length in the file');
  }
  skip(n: number): void { if (n > this.left) throw new Error('The file ends early'); this.pos += n; }
}

/** Parse a .mid file. Throws with a readable message when it isn't one. */
export function parseMidiFile(bytes: Uint8Array): MidiFileData {
  const r = new Reader(bytes);
  if (bytes.length < 14 || r.str(4) !== 'MThd') throw new Error('Not a MIDI file (.mid)');
  const headerLen = r.u32();
  const format = r.u16();
  const trackCount = r.u16();
  const division = r.u16();
  r.skip(Math.max(0, headerLen - 6));
  if (format > 2) throw new Error('An unknown kind of MIDI file');

  const raw: RawEvent[] = [];
  let order = 0;
  for (let tr = 0; tr < trackCount && r.left >= 8; tr++) {
    const id = r.str(4), len = r.u32();
    if (id !== 'MTrk') { r.skip(Math.min(len, r.left)); tr--; continue; }
    const end = Math.min(bytes.length, r.pos + len);
    let tick = 0, running = 0;
    while (r.pos < end) {
      tick += r.vlq();
      let status = r.u8();
      if (status < 0x80) {
        // Running status: this byte is data for the previous channel message.
        if (!running) throw new Error('A broken track in the file');
        r.pos--; status = running;
      }
      if (status === 0xff) {
        const type = r.u8(), l = r.vlq();
        if (type === 0x51 && l === 3) raw.push({ tick, order: order++, status: 0xff, d1: 0, d2: 0, tempo: (r.u8() << 16) | (r.u8() << 8) | r.u8() });
        else r.skip(l);
        if (type === 0x2f) { raw.push({ tick, order: order++, status: 0, d1: 0, d2: 0 }); break; }
        continue;
      }
      if (status === 0xf0 || status === 0xf7) { r.skip(r.vlq()); continue; }
      if (status >= 0xf0) continue; // system common/real-time: no data we keep
      running = status;
      const type = status & 0xf0;
      const d1 = r.u8();
      const d2 = type === 0xc0 || type === 0xd0 ? 0 : r.u8();
      if (type === 0x80 || type === 0x90 || type === 0xb0 || type === 0xe0) raw.push({ tick, order: order++, status, d1, d2 });
    }
    r.pos = end;
  }

  raw.sort((a, b) => a.tick - b.tick || a.order - b.order);
  // Ticks → seconds through the tempo map (default 120 bpm). SMPTE division: fixed frames × ticks per second.
  const smpte = (division & 0x8000) !== 0;
  const ticksPerSecond = smpte ? (256 - (division >> 8)) * (division & 0xff) : 0;
  const ppq = smpte ? 0 : Math.max(1, division);
  let usPerQuarter = 500000, lastTick = 0, lastT = 0;
  const events: MidiFileEvent[] = [];
  const channels = new Set<number>();
  let notes = 0, duration = 0;
  for (const e of raw) {
    const t = smpte ? e.tick / ticksPerSecond : lastT + ((e.tick - lastTick) * usPerQuarter) / ppq / 1e6;
    lastTick = e.tick; lastT = t;
    duration = Math.max(duration, t);
    if (e.tempo !== undefined) { usPerQuarter = e.tempo || 500000; continue; }
    if (!e.status) continue; // end of track: counts for the duration only
    events.push({ t, status: e.status, d1: e.d1, d2: e.d2 });
    channels.add((e.status & 0x0f) + 1);
    if ((e.status & 0xf0) === 0x90 && e.d2 > 0) notes++;
  }
  return { events, duration, notes, channels: [...channels].sort((a, b) => a - b) };
}

/** Index of the first event at or after `t` (binary search). */
export function eventIndexAt(events: readonly MidiFileEvent[], t: number): number {
  let lo = 0, hi = events.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (events[mid].t < t) lo = mid + 1; else hi = mid; }
  return lo;
}

/** "2:31" */
export function formatDuration(s: number): string {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
