/**
 * encode.ts — a separated stem made small for the library (docs/stems.md): Opus at 160 kb/s in a WebM file (about
 * 3.6 MB for 3 minutes) through WebCodecs' AudioEncoder, where the browser has it and can encode Opus; otherwise a
 * 16-bit WAV (about 32 MB for 3 minutes). Both decode with decodeAudioData in Chromium and WebKit.
 *
 * The WebM is written here (a tiny Matroska muxer: one audio track, SimpleBlocks in clusters of ≤ 5 s): no muxer
 * dependency. Its CodecDelay carries the encoder's pre-skip, so decoders drop the priming samples and the stem lines up
 * with the song (within about 1 ms: Chromium measured 32 samples late at 44.1 kHz, from its resampler).
 */

export interface EncodedStem { bytes: Uint8Array; type: string; codec: 'opus' | 'wav' }

export const OPUS_BITRATE = 160_000;

// ── EBML ─────────────────────────────────────────────────────────────────────────────────────────────────────

type Ebml = Uint8Array;

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** An element id's bytes (ids carry their own length marker). */
function idBytes(id: number): Uint8Array {
  const out: number[] = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v & 0xff);
  return Uint8Array.from(out);
}

/** A size as an EBML variable-length integer (the shortest that fits, 1–8 bytes). */
export function vint(n: number): Uint8Array {
  for (let len = 1; len <= 8; len++) {
    if (n < 2 ** (7 * len) - 1) {
      const out = new Uint8Array(len);
      let v = n;
      for (let i = len - 1; i >= 0; i--) { out[i] = v & 0xff; v = Math.floor(v / 256); }
      out[0] |= 1 << (8 - len);
      return out;
    }
  }
  throw new Error('Too big for EBML');
}

const el = (id: number, body: Uint8Array): Ebml => concat([idBytes(id), vint(body.length), body]);
const uint = (id: number, v: number): Ebml => {
  const out: number[] = [];
  let x = Math.max(0, Math.floor(v));
  do { out.unshift(x & 0xff); x = Math.floor(x / 256); } while (x > 0);
  return el(id, Uint8Array.from(out));
};
const float = (id: number, v: number): Ebml => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v); return el(id, b); };
const str = (id: number, s: string): Ebml => el(id, new TextEncoder().encode(s));

export interface OpusPacket { data: Uint8Array; /** µs */ timestamp: number }

/**
 * A WebM file of Opus packets (stereo or mono). `opusHead` is the codec's identification header (the encoder's
 * decoderConfig.description); `preSkip` its priming samples at 48 kHz; `durationMs` the sound's length.
 */
export function muxWebmOpus(packets: readonly OpusPacket[], o: { opusHead: Uint8Array; channels: number; durationMs: number; preSkip: number }): Uint8Array {
  const header = el(0x1a45dfa3, concat([
    uint(0x4286, 1), uint(0x42f7, 1), uint(0x42f2, 4), uint(0x42f3, 8), str(0x4282, 'webm'), uint(0x4287, 4), uint(0x4285, 2),
  ]));
  const info = el(0x1549a966, concat([uint(0x2ad7b1, 1_000_000), str(0x4d80, 'Playfield'), str(0x5741, 'Playfield'), float(0x4489, o.durationMs)]));
  const tracks = el(0x1654ae6b, el(0xae, concat([
    uint(0xd7, 1), uint(0x73c5, 1), uint(0x83, 2), str(0x86, 'A_OPUS'), el(0x63a2, o.opusHead),
    uint(0x56aa, Math.round((o.preSkip * 1e9) / 48000)), uint(0x56bb, 80_000_000),
    el(0xe1, concat([float(0xb5, 48000), uint(0x9f, o.channels)])),
  ])));
  const clusters: Uint8Array[] = [];
  let i = 0;
  while (i < packets.length) {
    const startMs = Math.round(packets[i].timestamp / 1000);
    const blocks: Uint8Array[] = [uint(0xe7, startMs)];
    while (i < packets.length) {
      const rel = Math.round(packets[i].timestamp / 1000) - startMs;
      if (rel > 5000) break;
      const p = packets[i];
      const head = new Uint8Array(4);
      head[0] = 0x81; // track 1
      new DataView(head.buffer).setInt16(1, rel);
      head[3] = 0x80; // keyframe
      blocks.push(el(0xa3, concat([head, p.data])));
      i++;
    }
    clusters.push(el(0x1f43b675, concat(blocks)));
  }
  const segment = el(0x18538067, concat([info, tracks, ...clusters]));
  return concat([header, segment]);
}

/** Read a WebM's top-level layout back (for tests): element ids and sizes, children of Segment / Cluster too. */
export function readEbml(b: Uint8Array, from = 0, to = b.length): Array<{ id: number; start: number; size: number; children?: ReturnType<typeof readEbml> }> {
  const out: Array<{ id: number; start: number; size: number; children?: ReturnType<typeof readEbml> }> = [];
  let p = from;
  const readVint = (keepMarker: boolean): number => {
    const first = b[p];
    let len = 1;
    while (len <= 8 && !(first & (1 << (8 - len)))) len++;
    let v = keepMarker ? first : first & ((1 << (8 - len)) - 1);
    for (let k = 1; k < len; k++) v = v * 256 + b[p + k];
    p += len;
    return v;
  };
  while (p < to) {
    const id = readVint(true), size = readVint(false), start = p;
    const parent = id === 0x18538067 || id === 0x1f43b675 || id === 0x1654ae6b || id === 0xae || id === 0x1a45dfa3 || id === 0x1549a966 || id === 0xe1;
    out.push({ id, start, size, ...(parent ? { children: readEbml(b, start, start + size) } : {}) });
    p = start + size;
  }
  return out;
}

/** An OpusHead for when the encoder gives none (RFC 7845). */
export function opusHead(channels: number, preSkip: number, inputRate: number): Uint8Array {
  const b = new Uint8Array(19), v = new DataView(b.buffer);
  b.set(new TextEncoder().encode('OpusHead'), 0);
  b[8] = 1; b[9] = channels;
  v.setUint16(10, preSkip, true); v.setUint32(12, inputRate, true); v.setInt16(16, 0, true); b[18] = 0;
  return b;
}

/** The pre-skip an OpusHead says (samples at 48 kHz), or null when it isn't one. */
export function preSkipOf(head: Uint8Array): number | null {
  if (head.length < 19 || new TextDecoder().decode(head.subarray(0, 8)) !== 'OpusHead') return null;
  return new DataView(head.buffer, head.byteOffset, head.byteLength).getUint16(10, true);
}

// ── WAV ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** A 16-bit PCM WAV of a stereo pair. */
export function encodeWav(left: Float32Array, right: Float32Array, sampleRate: number): Uint8Array {
  const n = left.length, data = n * 4, buf = new ArrayBuffer(44 + data), v = new DataView(buf);
  const tag = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  tag(0, 'RIFF'); v.setUint32(4, 36 + data, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); tag(36, 'data'); v.setUint32(40, data, true);
  for (let i = 0; i < n; i++) {
    v.setInt16(44 + i * 4, Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), true);
    v.setInt16(46 + i * 4, Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), true);
  }
  return new Uint8Array(buf);
}

// ── Opus through WebCodecs ───────────────────────────────────────────────────────────────────────────────────

interface AudioEncoderLike {
  configure(c: object): void;
  encode(d: unknown): void;
  flush(): Promise<void>;
  close(): void;
}
type AudioEncoderCtor = {
  new (init: { output: (chunk: { byteLength: number; timestamp: number; copyTo(b: Uint8Array): void }, meta?: { decoderConfig?: { description?: BufferSource } }) => void; error: (e: Error) => void }): AudioEncoderLike;
  isConfigSupported(c: object): Promise<{ supported?: boolean }>;
};
type AudioDataCtor = new (init: object) => { close(): void };

const opusConfig = (sampleRate: number) => ({ codec: 'opus', sampleRate, numberOfChannels: 2, bitrate: OPUS_BITRATE });

/** Can this browser (or worker) encode Opus? */
export async function canEncodeOpus(sampleRate: number): Promise<boolean> {
  const g = globalThis as unknown as { AudioEncoder?: AudioEncoderCtor; AudioData?: AudioDataCtor };
  if (!g.AudioEncoder || !g.AudioData) return false;
  try { return !!(await g.AudioEncoder.isConfigSupported(opusConfig(sampleRate))).supported; } catch { return false; }
}

/** A stem as Opus in WebM, or null when this browser can't encode Opus. */
export async function encodeOpusWebm(left: Float32Array, right: Float32Array, sampleRate: number): Promise<Uint8Array | null> {
  const g = globalThis as unknown as { AudioEncoder?: AudioEncoderCtor; AudioData?: AudioDataCtor };
  if (!(await canEncodeOpus(sampleRate))) return null;
  const packets: OpusPacket[] = [];
  let head: Uint8Array | null = null, failed: Error | null = null;
  const enc = new g.AudioEncoder!({
    output: (chunk, meta) => {
      const d = meta?.decoderConfig?.description;
      if (d && !head) head = d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array((d as ArrayBufferView).buffer.slice((d as ArrayBufferView).byteOffset, (d as ArrayBufferView).byteOffset + (d as ArrayBufferView).byteLength));
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      packets.push({ data, timestamp: chunk.timestamp });
    },
    error: e => { failed = e; },
  });
  enc.configure(opusConfig(sampleRate));
  const block = sampleRate; // one second at a time
  for (let at = 0; at < left.length && !failed; at += block) {
    const n = Math.min(block, left.length - at);
    const planar = new Float32Array(n * 2);
    planar.set(left.subarray(at, at + n), 0);
    planar.set(right.subarray(at, at + n), n);
    const data = new g.AudioData!({ format: 'f32-planar', sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((at / sampleRate) * 1e6), data: planar });
    enc.encode(data);
    data.close();
  }
  await enc.flush();
  enc.close();
  if (failed) throw failed;
  const h: Uint8Array = head ?? opusHead(2, 312, sampleRate);
  return muxWebmOpus(packets, { opusHead: h, channels: 2, durationMs: (left.length / sampleRate) * 1000, preSkip: preSkipOf(h) ?? 312 });
}

/** A stem for the library: Opus in WebM where it can be, else a 16-bit WAV. */
export async function encodeStem(left: Float32Array, right: Float32Array, sampleRate: number, o: { allowOpus?: boolean } = {}): Promise<EncodedStem> {
  if (o.allowOpus !== false) {
    try {
      const webm = await encodeOpusWebm(left, right, sampleRate);
      if (webm) return { bytes: webm, type: 'audio/webm', codec: 'opus' };
    } catch (e) { console.warn('[stems] Opus encoding failed, keeping WAV', e); }
  }
  return { bytes: encodeWav(left, right, sampleRate), type: 'audio/wav', codec: 'wav' };
}
