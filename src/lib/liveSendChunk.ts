/**
 * liveSendChunk.ts — the binary message the desktop app sends the page every 10 ms with the
 * audio of every subscribed Playfield Send instance (src-tauri/src/live_send.rs `encode_chunk`):
 *
 *   [u32 LE header length][JSON header, space-padded to 4 bytes][f32 LE PCM]
 *   header: { seq, rate, s: [{ id, n, drop }] }   n stereo frames per part, interleaved, in order
 *
 * Also the page-side jitter buffer (`JITTER_SOURCE`, plain JS so the AudioWorklet and the tests run
 * the very same code) and an encoder for the fake sender and the tests.
 */

export interface LiveSendPart { id: number; n: number; drop: number }
export interface LiveSendHeader { seq: number; rate: number; s: LiveSendPart[] }
export interface LiveSendChunk { header: LiveSendHeader; pcm: Float32Array[] }

/** Read a chunk (null when malformed). Each part's PCM is its own copy, ready to transfer. */
export function decodeLiveSendChunk(buf: ArrayBuffer): LiveSendChunk | null {
  if (buf.byteLength < 4) return null;
  const len = new DataView(buf).getUint32(0, true);
  if (4 + len > buf.byteLength) return null;
  let header: LiveSendHeader;
  try {
    header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len))) as LiveSendHeader;
  } catch { return null; }
  if (!header || !Array.isArray(header.s)) return null;
  let at = 4 + len;
  const pcm: Float32Array[] = [];
  for (const p of header.s) {
    const bytes = p.n * 8;
    if (!(p.n >= 0) || at + bytes > buf.byteLength) return null;
    // A copy (slice), so it can be transferred to the worklet on its own; little-endian on every Mac.
    pcm.push(new Float32Array(buf.slice(at, at + bytes)));
    at += bytes;
  }
  return { header, pcm };
}

/** Write a chunk (the fake sender and the tests: the same layout as the Rust side). */
export function encodeLiveSendChunk(header: LiveSendHeader, pcm: Float32Array[]): ArrayBuffer {
  let json = JSON.stringify(header);
  while (new TextEncoder().encode(json).length % 4) json += ' ';
  const head = new TextEncoder().encode(json);
  const floats = pcm.reduce((a, p) => a + p.length, 0);
  const out = new ArrayBuffer(4 + head.length + floats * 4);
  new DataView(out).setUint32(0, head.length, true);
  new Uint8Array(out, 4, head.length).set(head);
  let at = 4 + head.length;
  for (const p of pcm) { new Float32Array(out, at, p.length).set(p); at += p.length * 4; }
  return out;
}

/**
 * The receive buffer (inside the AudioWorklet): stereo frames in, render quanta out.
 *
 * - It starts once `target` frames (the cushion, ~30 ms) are in, and plays silence until then.
 * - Over 2× the cushion (the page's clock is slower than Live's, or a burst after a stall): the
 *   oldest frames are dropped back to the cushion.
 * - Under ½ the cushion (the page's clock is faster): one quantum of silence is played without
 *   reading, which lets the buffer refill. Empty: it waits for the cushion again (an underrun).
 *
 * At ~50 ppm drift that is one drop or pad every few minutes, which analysis doesn't notice.
 */
export const JITTER_SOURCE = `
class PfJitter {
  constructor(capacity, target) {
    this.cap = capacity;
    this.buf = new Float32Array(capacity * 2);
    this.r = 0; this.w = 0; this.fill = 0;
    this.target = Math.max(1, Math.min(target, capacity >> 1));
    this.running = false;
    this.drops = 0; this.pads = 0; this.underruns = 0;
  }
  setTarget(t) { this.target = Math.max(1, Math.min(t, this.cap >> 1)); }
  push(pcm) {
    const n = pcm.length >> 1;
    for (let i = 0; i < n; i++) {
      if (this.fill >= this.cap) { this.r = (this.r + 1) % this.cap; this.fill--; this.drops++; }
      this.buf[this.w * 2] = pcm[i * 2]; this.buf[this.w * 2 + 1] = pcm[i * 2 + 1];
      this.w = (this.w + 1) % this.cap; this.fill++;
    }
    if (this.fill > this.target * 2) {
      const cut = this.fill - this.target;
      this.r = (this.r + cut) % this.cap; this.fill -= cut; this.drops++;
    }
  }
  pull(l, r, n) {
    if (!this.running && this.fill >= this.target) this.running = true;
    if (!this.running) { l.fill(0, 0, n); r.fill(0, 0, n); return false; }
    if (this.fill < n) {
      l.fill(0, 0, n); r.fill(0, 0, n);
      this.running = false; this.underruns++;
      return false;
    }
    if (this.fill < this.target >> 1) { l.fill(0, 0, n); r.fill(0, 0, n); this.pads++; return false; }
    for (let i = 0; i < n; i++) {
      l[i] = this.buf[this.r * 2]; r[i] = this.buf[this.r * 2 + 1];
      this.r = (this.r + 1) % this.cap;
    }
    this.fill -= n;
    return true;
  }
}
`;

/** The worklet: a jitter buffer per node, fed by `port.postMessage(Float32Array)`, stats every ~0.5 s. */
export const RECEIVE_SOURCE = `${JITTER_SOURCE}
class PlayfieldReceive extends AudioWorkletProcessor {
  constructor(o) {
    super();
    const p = (o && o.processorOptions) || {};
    this.j = new PfJitter(Math.max(4096, (sampleRate | 0) * 2), Math.round((p.cushionMs > 0 ? p.cushionMs : 30) * sampleRate / 1000));
    this.on = true;
    this.n = 0;
    this.port.onmessage = e => {
      const d = e.data;
      if (d instanceof Float32Array) this.j.push(d);
      else if (d === 'stop') this.on = false;
      else if (d && typeof d.cushionMs === 'number') this.j.setTarget(Math.round(d.cushionMs * sampleRate / 1000));
    };
  }
  process(inputs, outputs) {
    if (!this.on) return false;
    const out = outputs[0];
    if (!out || !out.length) return true;
    const l = out[0], r = out[1] || out[0];
    this.j.pull(l, r, l.length);
    if (++this.n % 188 === 0) this.port.postMessage({ fill: this.j.fill, target: this.j.target, drops: this.j.drops, pads: this.j.pads, underruns: this.j.underruns });
    return true;
  }
}
registerProcessor('playfield-receive', PlayfieldReceive);
`;

/** The jitter buffer as a class, for the tests (the same source the worklet runs). */
export interface PfJitter {
  fill: number; target: number; running: boolean; drops: number; pads: number; underruns: number;
  setTarget(t: number): void;
  push(pcm: Float32Array): void;
  pull(l: Float32Array, r: Float32Array, n: number): boolean;
}
export function makeJitter(capacity: number, target: number): PfJitter {
  const Ctor = new Function(`${JITTER_SOURCE}; return PfJitter;`)() as new (c: number, t: number) => PfJitter;
  return new Ctor(capacity, target);
}
