/**
 * webmMuxer — a small in-memory WebM (Matroska) writer for frames WebCodecs'
 * VideoEncoder made (VP9 or VP8), with exact timestamps.
 *
 * Why it exists: MediaRecorder stamps frames with the wall clock, so a render
 * slower than real time comes out at the wrong speed. A bake renders frame by
 * frame, as slowly as the graph needs, and still has to play back at exactly
 * `fps`, so it encodes with WebCodecs and writes the container itself.
 *
 * Layout (everything is known up front, so sizes are exact, nothing is
 * patched afterwards):
 *   EBML header
 *   Segment
 *     SeekHead   → Info, Tracks, Cues (fixed 8-byte positions)
 *     Info       (1 ms timecode scale, Duration)
 *     Tracks     (one video track)
 *     Cues       (one point per cluster, so seeking is quick)
 *     Cluster…   (one per keyframe, SimpleBlocks)
 *
 * Alpha never goes in the container: a bake with alpha packs it into the
 * picture itself (lib/bake/plan.ts packAlpha), which every player decodes.
 */

export interface WebmFrame {
  /** The encoded frame (EncodedVideoChunk bytes). */
  data: Uint8Array;
  /** Presentation time in microseconds. */
  timestampUs: number;
  key: boolean;
}

export interface WebmOptions {
  codec: 'vp9' | 'vp8';
  width: number;
  height: number;
  fps: number;
  /** Total length in seconds (written as the Duration). */
  duration: number;
  /**
   * How the frames' colours are coded (Matroska Colour codes: matrix 6 =
   * BT.601, range 1 = limited, transfer 13 = sRGB, primaries 1 = BT.709/sRGB).
   */
  colour?: { matrix: number; range: number; transfer: number; primaries: number };
}

const enc = new TextEncoder();

/** An EBML element ID's bytes (IDs keep their length-marker bits). */
function idBytes(id: number): Uint8Array {
  const out: number[] = [];
  let v = id;
  while (v > 0) { out.unshift(v & 0xff); v = Math.floor(v / 256); }
  return Uint8Array.from(out);
}

/** An EBML size as a variable-length integer (1–8 bytes). */
export function vint(n: number): Uint8Array {
  for (let len = 1; len <= 8; len++) {
    // A size of all ones is reserved for "unknown", so stay one below it.
    if (n < 2 ** (7 * len) - 1) {
      const out = new Uint8Array(len);
      let v = n;
      for (let i = len - 1; i >= 0; i--) { out[i] = v & 0xff; v = Math.floor(v / 256); }
      out[0] |= 1 << (8 - len);
      return out;
    }
  }
  throw new Error(`EBML size too large: ${n}`);
}

/** An unsigned integer, big-endian, in the fewest bytes (or exactly `fixed`). */
function uintBytes(n: number, fixed?: number): Uint8Array {
  let len = fixed ?? 1;
  if (!fixed) while (n >= 2 ** (8 * len)) len++;
  const out = new Uint8Array(len);
  let v = n;
  for (let i = len - 1; i >= 0; i--) { out[i] = v & 0xff; v = Math.floor(v / 256); }
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function el(id: number, payload: Uint8Array | Uint8Array[]): Uint8Array {
  const body = Array.isArray(payload) ? concat(payload) : payload;
  return concat([idBytes(id), vint(body.length), body]);
}
const uintEl = (id: number, n: number, fixed?: number) => el(id, uintBytes(n, fixed));
const strEl = (id: number, s: string) => el(id, enc.encode(s));
function floatEl(id: number, f: number): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, f);
  return el(id, b);
}

const ID = {
  EBML: 0x1a45dfa3, EBMLVersion: 0x4286, EBMLReadVersion: 0x42f7, EBMLMaxIDLength: 0x42f2,
  EBMLMaxSizeLength: 0x42f3, DocType: 0x4282, DocTypeVersion: 0x4287, DocTypeReadVersion: 0x4285,
  Segment: 0x18538067, SeekHead: 0x114d9b74, Seek: 0x4dbb, SeekID: 0x53ab, SeekPosition: 0x53ac,
  Info: 0x1549a966, TimecodeScale: 0x2ad7b1, MuxingApp: 0x4d80, WritingApp: 0x5741, Duration: 0x4489,
  Tracks: 0x1654ae6b, TrackEntry: 0xae, TrackNumber: 0xd7, TrackUID: 0x73c5, TrackType: 0x83,
  FlagLacing: 0x9c, CodecID: 0x86, DefaultDuration: 0x23e383,
  Video: 0xe0, PixelWidth: 0xb0, PixelHeight: 0xba,
  Colour: 0x55b0, MatrixCoefficients: 0x55b1, Range: 0x55b9, TransferCharacteristics: 0x55ba, Primaries: 0x55bb,
  Cues: 0x1c53bb6b, CuePoint: 0xbb, CueTime: 0xb3, CueTrackPositions: 0xb7, CueTrack: 0xf7, CueClusterPosition: 0xf1,
  Cluster: 0x1f43b675, Timecode: 0xe7, SimpleBlock: 0xa3,
} as const;

/** A SimpleBlock's body: track 1, the time relative to its cluster, flags, the frame. */
function blockBody(rel: number, flags: number, data: Uint8Array): Uint8Array {
  const head = new Uint8Array(4);
  head[0] = 0x81; // track number 1 as a vint
  new DataView(head.buffer).setInt16(1, rel);
  head[3] = flags;
  return concat([head, data]);
}

/** Write the frames (in presentation order) as one WebM file. */
export function muxWebm(frames: WebmFrame[], opts: WebmOptions): Uint8Array {
  if (!frames.length) throw new Error('No frames to write');
  if (!frames[0].key) throw new Error('The first frame must be a keyframe');

  const header = el(ID.EBML, [
    uintEl(ID.EBMLVersion, 1), uintEl(ID.EBMLReadVersion, 1),
    uintEl(ID.EBMLMaxIDLength, 4), uintEl(ID.EBMLMaxSizeLength, 8),
    strEl(ID.DocType, 'webm'), uintEl(ID.DocTypeVersion, 4), uintEl(ID.DocTypeReadVersion, 2),
  ]);

  const info = el(ID.Info, [
    uintEl(ID.TimecodeScale, 1_000_000),
    strEl(ID.MuxingApp, 'Playfield bake'), strEl(ID.WritingApp, 'Playfield bake'),
    floatEl(ID.Duration, opts.duration * 1000),
  ]);

  const c = opts.colour;
  const video = el(ID.Video, [
    uintEl(ID.PixelWidth, opts.width), uintEl(ID.PixelHeight, opts.height),
    ...(c ? [el(ID.Colour, [uintEl(ID.MatrixCoefficients, c.matrix), uintEl(ID.Range, c.range), uintEl(ID.TransferCharacteristics, c.transfer), uintEl(ID.Primaries, c.primaries)])] : []),
  ]);
  const tracks = el(ID.Tracks, el(ID.TrackEntry, [
    uintEl(ID.TrackNumber, 1), uintEl(ID.TrackUID, 1), uintEl(ID.TrackType, 1),
    uintEl(ID.FlagLacing, 0), strEl(ID.CodecID, opts.codec === 'vp8' ? 'V_VP8' : 'V_VP9'),
    uintEl(ID.DefaultDuration, Math.round(1e9 / opts.fps)),
    video,
  ]));

  // Clusters: a new one at every keyframe, or when the 16-bit relative time would overflow.
  const clusters: { timeMs: number; bytes: Uint8Array }[] = [];
  let current: { timeMs: number; blocks: Uint8Array[] } | null = null;
  const flush = () => {
    if (current) clusters.push({ timeMs: current.timeMs, bytes: el(ID.Cluster, [uintEl(ID.Timecode, current.timeMs), ...current.blocks]) });
  };
  for (const f of frames) {
    const ms = Math.round(f.timestampUs / 1000);
    if (!current || f.key || ms - current.timeMs > 30_000) {
      flush();
      current = { timeMs: ms, blocks: [] };
    }
    current.blocks.push(el(ID.SimpleBlock, blockBody(ms - current.timeMs, f.key ? 0x80 : 0, f.data)));
  }
  flush();

  // Cues use fixed 8-byte positions, so their size doesn't depend on where clusters land.
  const cuePoint = (timeMs: number, pos: number) => el(ID.CuePoint, [
    uintEl(ID.CueTime, timeMs),
    el(ID.CueTrackPositions, [uintEl(ID.CueTrack, 1), uintEl(ID.CueClusterPosition, pos, 8)]),
  ]);
  const seekEntry = (id: number, pos: number) => el(ID.Seek, [el(ID.SeekID, idBytes(id)), uintEl(ID.SeekPosition, pos, 8)]);
  const seekHeadSize = el(ID.SeekHead, [seekEntry(ID.Info, 0), seekEntry(ID.Tracks, 0), seekEntry(ID.Cues, 0)]).length;
  const cuesSize = el(ID.Cues, clusters.map(c => cuePoint(c.timeMs, 0))).length;

  const infoPos = seekHeadSize;
  const tracksPos = infoPos + info.length;
  const cuesPos = tracksPos + tracks.length;
  let clusterPos = cuesPos + cuesSize;
  const positions = clusters.map(c => { const p = clusterPos; clusterPos += c.bytes.length; return p; });

  const seekHead = el(ID.SeekHead, [seekEntry(ID.Info, infoPos), seekEntry(ID.Tracks, tracksPos), seekEntry(ID.Cues, cuesPos)]);
  const cues = el(ID.Cues, clusters.map((c, i) => cuePoint(c.timeMs, positions[i])));
  const segment = el(ID.Segment, [seekHead, info, tracks, cues, ...clusters.map(c => c.bytes)]);
  return concat([header, segment]);
}
